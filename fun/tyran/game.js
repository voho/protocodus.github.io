import { WORLDS, PARALLAX_LAYERS, WorldRenderer } from './worlds.js';
import { ENEMY_TYPES, SHIP_PALETTES, drawShip, warmShipSprites } from './ships.js';
import { createCampaign, beginLevel, update, buyUpgrade, upgradeCost, UPGRADES, WEAPONS, BULLET_SPECTRUM, MAX_UPGRADE, clamp, selectWeapon, shipStats, weaponStats, SECONDARY_ENERGY_COST, SECONDARY_RESTART_ENERGY, bossWeakPointPosition, applyGroundReward,
  PRIMARIES, SUPPLIES, buyPrimary, buySupply, supplyCost, supplyStock, primaryStats, firingInterval, MAX_POWER } from './sim.js';
import { isDormant, directorProgress } from './waves.js';
import { Effects, warmEffectsTextures } from './effects.js';
import { CombatFeedback } from './combat-feedback.js';
import { difficultyProfile, normalizeDifficulty } from './difficulty.js';
import { AudioEngine, preloadAudio } from './audio.js';
import { readCampaign, writeCampaign } from './save-game.js';
import { spritesReady, spriteStatus } from './sprite-assets.js';
import { drawProjectiles, warmProjectileTextures } from './projectile-sprites.js';
import { BONUS_KINDS, BONUS_PALETTE, pickupTexture } from './bonus-sprites.js';
import { environmentIndex, campaignCycle, normalizeLevel } from './campaign.js';
import { warmShopArt, shopArtMarkup } from './shop-art.js';

const environment = level => WORLDS[environmentIndex(level)];
const sectorLabel = level => `Sector ${String(level + 1).padStart(2, '0')} · Cycle ${campaignCycle(level) + 1}`;
const sectorSeed = level => campaignCycle(level) ? `tyran-v2-cycle-${campaignCycle(level) + 1}` : 'tyran-v2';
const nextSector = level => Math.min(Number.MAX_SAFE_INTEGER, level + 1);

// Finish downloads, font loading and sound decoding before enabling launch.
await Promise.all([
  spritesReady,
  ...[400, 500, 600, 700].map(weight => document.fonts.load(`${weight} 14px "Chakra Petch"`).catch(() => [])),
  preloadAudio(({ completed, total }) => {
    document.getElementById('startup-status').textContent = `Preparing flight… ${Math.round(completed / total * 100)}%`;
  }),
]);

const elements = new Map();
const $ = id => { if (!elements.has(id)) { const el = document.getElementById(id); if (el) elements.set(id, el); } return elements.get(id); };
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const setFill = (el, fraction) => { const transform = `scaleX(${Number(clamp(fraction, 0, 1).toFixed(3))})`; if (el.style.transform !== transform) el.style.transform = transform; };
const setHidden = (el, hidden) => { if (el.hidden !== hidden) el.hidden = hidden; };
const setAttribute = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
const canvas = $('game-canvas'), ctx = canvas.getContext('2d', { alpha: false });
const world = new WorldRenderer(), fx = new Effects(), audio = new AudioEngine();
const feedback = new CombatFeedback();
let feedbackRevision = -1;
const keys = new Set(), numberFormat = new Intl.NumberFormat('en-US'), number = n => numberFormat.format(Math.floor(n || 0));
const compactRewardFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const rewardNumber = n => n >= 1_000_000 ? compactRewardFormat.format(n) : number(n);
const screens = ['menu-screen', 'pause-screen', 'hangar-screen', 'end-screen'];
let campaign = campaignSummary(readCampaign()), campaignError = null, activeCampaign = false, lastAutosaveTime = 0;
let state = null, selected = 0, scene = 'menu', unlocked = campaign.run?.unlocked || 0;
let W = 1200, H = 900, dpr = 1, previewScroll = 0, clock = 0, lastTime = 0, hudClock = 0;
let surfaceWidth = 0, surfaceHeight = 0;
let announcementUntil = 0, quality = 'high', helpPaused = false, helpFocus = null;
let selectedDifficulty = 'easy';
let keyboardLockEpoch = 0;
const STEP = 1 / 60;
let accumulator = 0, previousScroll = 0, renderAlpha = 1, renderDirty = true, frameHandle = 0, idleHandle = 0, hitstop = 0;
let resolutionScale = 1, frameAverage = 16.7, fastestFrame = 100, lastAdapt = 0, vignette = null;
const perf = { fps: 60, frameMs: 16.7, renderMs: 0, updateMs: 0, renderScale: 1, frames: 0, steps: 0 };
const environmentHit = (...args) => {
  if (state) {
    let focus = 0, pilots = 0;
    for (const player of state.players) if (player.alive) { focus += player.x; pilots++; }
    world.prepareGround(state.width, state.height, args[4] ?? state.scroll, pilots ? focus / pilots : state.width * .5);
  }
  return world.hit(...args);
};
const lerp = (before, after) => (before ?? after) + (after - (before ?? after)) * renderAlpha;
const controls = [{ x: 0, y: 0, fire: false, secondary: false, bomb: false }];
const touch = { x: 0, y: 0, fire: false, secondary: false, bomb: false, pointer: null, originX: 0, originY: 0 };

let bestScore = 0;
try {
  audio.mute(localStorage.getItem('tyran-muted') === 'true');
  quality = localStorage.getItem('tyran-quality') === 'low' ? 'low' : 'high';
  selectedDifficulty = normalizeDifficulty(localStorage.getItem('tyran-difficulty'));
  bestScore = Math.max(0, Math.floor(Number(localStorage.getItem('tyran-best-score')) || 0));
} catch { /* Local saves are optional in private/restricted browsing. */ }

// The arcade high score: campaign flights only, kept in this browser.
function recordBestScore() {
  if (!state || !activeCampaign || state.score <= bestScore) return false;
  bestScore = Math.floor(state.score);
  try { localStorage.setItem('tyran-best-score', String(bestScore)); } catch { /* optional */ }
  return true;
}

// Resume reads the authoritative local save on demand. Keep only menu metadata
// here, rather than a second entire flight and destruction ledger after each save.
function campaignSummary(result) {
  if (!result.run) return result;
  const { scene, unlocked, state: { level, credits, score, difficulty } } = result.run;
  return { ok: result.ok, error: result.error, run: { scene, unlocked, state: { level, credits, score, difficulty } } };
}

function saveStatus(message) {
  for (const id of ['save-summary', 'pause-save-status', 'hangar-save-status']) setText($(id), message);
}

function autosave() {
  if (!activeCampaign || !state || !['playing', 'hangar', 'victory'].includes(state.status)) return false;
  const result = writeCampaign(state, {
    seed: world.seed, damage: world.damage, destroyed: world.destroyed, unlocked,
  });
  // A failed write keeps the last resumable run and waits before trying again.
  lastAutosaveTime = state.time;
  campaignError = result.error;
  if (result.ok) campaign = campaignSummary(result);
  refreshContinue();
  return result.ok;
}

function resumeCampaign() {
  const result = readCampaign();
  campaign = campaignSummary(result); campaignError = null; refreshContinue();
  if (!result.ok || !result.run) return;
  const run = result.run;
  activeCampaign = true; lastAutosaveTime = run.state.time;
  state = run.state; unlocked = Math.max(unlocked, run.unlocked);
  // Fit the saved arena to the current screen while retaining health, velocity,
  // timers and formation relationships. Loaded flight never advances until Resume.
  const sx = W / state.width, sy = H / state.height;
  for (const list of [state.players, state.enemies, state.bullets, state.pickups]) for (const actor of list) {
    actor.x *= sx; actor.y *= sy; actor.px = actor.x; actor.py = actor.y;
    if (Number.isFinite(actor.originX)) actor.originX *= sx;
  }
  for (const pilot of state.players) {
    pilot.x = clamp(pilot.x, 30, W - 30); pilot.y = clamp(pilot.y, 105, H - 42); pilot.px = pilot.x; pilot.py = pilot.y;
    for (const drone of pilot.wing || []) { drone.x *= sx; drone.y *= sy; drone.px = drone.x; drone.py = drone.y; }
  }
  for (const enemy of state.enemies) scaleScriptX(enemy, sx);
  for (const formation of state.formations) {
    formation.x *= sx; formation.baseX *= sx; formation.y *= sy;
    for (const offset of formation.offsets) { offset.x *= sx; offset.y *= sy; }
  }
  state.width = W; state.height = H; selected = environmentIndex(state.level);
  world.setWorld(state.level, run.seed); world.restoreDamage(run.damage, run.destroyed, run.sceneryVersion);
  warmFleet(state.level); fx.reset(); feedback.reset(state); keys.clear(); clock = state.time;
  $('announcement').hidden = true; $('boss-hud').hidden = true;
  if (run.scene === 'hangar') showHangar(0, true);
  else if (run.scene === 'end') showEnd(true, true);
  else { setScreen('pause'); $('resume-button').focus({ preventScroll: true }); }
  refreshHUD();
  if (run.migrated) autosave();
  else refreshContinue();
}

// Scripted flight anchors are stored in arena pixels; keep them with the ships on resize.
function scaleScriptX(enemy, factor) {
  for (const key of ['stationX', 'capX', 'diveX0', 'diveTx', 'pathOx']) if (Number.isFinite(enemy[key])) enemy[key] *= factor;
}

function setScreen(next) {
  scene = next;
  for (const id of screens) if ($(id)) $(id).hidden = id !== `${next}-screen`;
  document.body.dataset.scene = next;
  // Instruments and touch controls reserve their space even behind menus.
  // Flight therefore uses the exact arena geometry prepared before launch.
  $('hud').hidden = false;
  $('hud').inert = next !== 'playing';
  if ($('touch-controls')) {
    $('touch-controls').hidden = false;
    $('touch-controls').inert = next !== 'playing';
  }
  syncArenaSize();
  // Also covers saved flights, sector transitions and resuming after a resize.
  if (next === 'playing' && state) world.prepareFlight(W, H, state.scroll);
  if (next !== 'playing') {
    audio.pause();
    keys.clear(); touch.x = touch.y = 0; touch.fire = touch.secondary = touch.bomb = false;
    const pointer = touch.pointer; touch.pointer = null;
    if (pointer != null && stick?.hasPointerCapture(pointer)) stick.releasePointerCapture(pointer);
    stick?.style.setProperty('--stick-x', '0px'); stick?.style.setProperty('--stick-y', '0px');
  }
  if (next !== 'playing' && next !== 'end') canvas.style.filter = '';
  syncKeyboardLock();
  if (state) {
    previousScroll = state.scroll;
    for (const list of [state.players, state.enemies, state.bullets]) for (const actor of list) { actor.px = actor.x; actor.py = actor.y; }
  }
  accumulator = 0; renderAlpha = 1; lastTime = 0; renderDirty = true; requestFrame();
}

function requestFrame() {
  if (frameHandle || document.hidden) return;
  if (idleHandle) { clearTimeout(idleHandle); idleHandle = 0; }
  frameHandle = requestAnimationFrame(frame);
}

function sizeSurface(rect, adaptive = false) {
  surfaceWidth = rect.width; surfaceHeight = rect.height;
  const pixelBudget = quality === 'high' ? 8_300_000 : 2_200_000;
  dpr = Math.min(devicePixelRatio || 1, quality === 'high' ? 1.7 : 1, Math.sqrt(pixelBudget / (rect.width * rect.height))) * resolutionScale;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  // Automatic resolution changes reuse the prepared terrain. Only an explicit
  // viewport/quality change replaces its backing surfaces.
  if (!adaptive) world.setDetailScale(canvas.width, quality);
  perf.renderScale = dpr;
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  vignette = ctx.createRadialGradient(W * .5, H * .5, H * .25, W * .5, H * .5, Math.max(W, H) * .75);
  vignette.addColorStop(0, '#02080d00'); vignette.addColorStop(1, '#02080d9c');
  renderDirty = true;
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const oldW = W, oldH = H;
  // Height fixes the camera scale. Additional screen width reveals more world
  // units; capping or rounding W would stretch the canvas to a different ratio.
  H = 900; W = H * Math.max(1, rect.width) / Math.max(1, rect.height);
  sizeSurface(rect);
  if (state) {
    state.width = W; state.height = H;
    for (const p of state.players) {
      p.x = clamp(p.x / oldW * W, 30, W - 30); p.y = p.y / oldH * H; p.px = p.x; p.py = p.y;
      for (const drone of p.wing || []) { drone.x = drone.x / oldW * W; drone.px = drone.x; drone.py = drone.y; }
    }
    for (const e of state.enemies) { e.x = e.x / oldW * W; e.originX = e.originX / oldW * W; e.px = e.x; e.py = e.y; scaleScriptX(e, W / oldW); }
    for (const formation of state.formations) {
      formation.x *= W / oldW; formation.baseX *= W / oldW; formation.y *= H / oldH;
      for (const offset of formation.offsets) { offset.x *= W / oldW; offset.y *= H / oldH; }
    }
    for (const b of state.bullets) { b.x *= W / oldW; b.px = b.x; b.py = b.y; }
    for (const p of state.pickups) p.x *= W / oldW;
    for (const list of [fx.particles, fx.rings, fx.lights, fx.flares]) for (const effect of list) if (!effect.ground) effect.x *= W / oldW;
  }
  if (scene === 'playing') world.prepareFlight(W, H, state.scroll);
  else world.prepare(W, H, scene === 'menu' || scene === 'hangar' ? 0 : state?.scroll || 0);
  requestFrame();
}

function syncArenaSize() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width !== surfaceWidth || rect.height !== surfaceHeight) resize();
}

function warmFleet(index) {
  index = environmentIndex(index);
  warmShipSprites(SHIP_PALETTES[index], index);
  warmShipSprites('#a4ffee', index, true);
  warmShipSprites(DRONE_COLOR, index, true); warmShipSprites(CAPTIVE_COLOR, index, true);
  warmProjectileTextures([...WEAPONS, ...PRIMARIES, { id: 'drone', kind: 'pulse', color: DRONE_COLOR }], BULLET_SPECTRUM);
  for (const kind of BONUS_KINDS) pickupTexture(kind);
  warmEffectsTextures([WORLDS[index].color, ...WEAPONS.filter(weapon => weapon.splash).map(weapon => weapon.color)]);
  pilotBarrierTexture();
}

// Every notice stays in the reserved instrument strip outside the arena.
function announce(kicker, title, description = '', seconds = 3, compact = false) {
  $('announcement').classList.toggle('compact', compact);
  $('announcement-kicker').textContent = kicker;
  $('announcement-title').textContent = title;
  $('announcement-description').textContent = description;
  $('announcement').hidden = false;
  announcementUntil = clock + seconds;
}

function launch(level = 0, checkpoint = null, persist = true) {
  audio.start();
  activeCampaign = persist; lastAutosaveTime = 0;
  level = normalizeLevel(level);
  selected = environmentIndex(level);
  state = createCampaign(level, checkpoint, selectedDifficulty);
  state.startLevel = checkpoint?.startLevel ?? level;
  state.width = W; state.height = H; beginLevel(state, level);
  world.setWorld(level, sectorSeed(level)); warmFleet(level); fx.reset(); feedback.reset(state); keys.clear(); previousScroll = 0; $('boss-hud').hidden = true;
  setScreen('playing');
  announce(sectorLabel(level), environment(level).name, environment(level).subtitle || 'Clear the skies. Bring everyone home.', 3.2);
  autosave(); refreshContinue();
  canvas.focus({ preventScroll: true });
  refreshHUD();
}

function returnToMenu() {
  autosave(); recordBestScore();
  state = null; activeCampaign = false; fx.reset(); feedback.reset(state); selectWorld(selected); setScreen('menu');
  $('announcement').hidden = true; $('boss-hud').hidden = true; refreshContinue();
  $(campaign.run ? 'continue-button' : 'launch-button').focus({ preventScroll: true });
}

function pause() {
  if (scene === 'playing') { setScreen('pause'); autosave(); $('resume-button').focus({ preventScroll: true }); }
  else if (scene === 'pause') { audio.start(); setScreen('playing'); canvas.focus({ preventScroll: true }); }
}

function waveLabel(s) {
  if (s.challenge && !s.challenge.done) return `Bonus stage · ${s.challenge.hits} / ${s.challenge.total}`;
  if (s.bossSpawned) return 'Guardian';
  const d = s.director, total = d?.plan.length || 0;
  return d ? `Wave ${String(Math.max(1, d.wave + 1)).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : '';
}
function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

function refreshDifficultyChoice() {
  const profile = difficultyProfile(selectedDifficulty);
  for (const option of $('difficulty-picker').querySelectorAll('input')) option.checked = option.value === profile.id;
  setText($('difficulty-description'), profile.description);
  setText($('launch-route'), `Sector 01 · ${profile.label} · Endless campaign`);
}

function renderCombatFeedback() {
  const el = $('combat-feedback');
  setHidden(el, !feedback.visible);
  if (feedbackRevision !== feedback.revision) {
    feedbackRevision = feedback.revision;
    setText($('combat-feedback-chain'), feedback.chain >= 2 ? `${feedback.label} ×${feedback.chain}` : 'Recent rewards');
    setText($('combat-feedback-score'), `+${rewardNumber(feedback.score)}`);
    setText($('combat-feedback-credits'), `$ +${rewardNumber(feedback.credits)}`);
    setAttribute($('combat-feedback-score'), 'title', `+${number(feedback.score)} score`);
    setAttribute($('combat-feedback-credits'), 'title', `+${number(feedback.credits)} credits`);
    setHidden($('combat-feedback-score').parentElement, feedback.score <= 0);
    setHidden($('combat-feedback-credits').parentElement, feedback.credits <= 0);
    setText($('combat-feedback-detail'), feedback.details);
    setAttribute(el, 'data-rampage', String(feedback.chain >= 5));
  }
  const opacity = String(Number(feedback.opacity.toFixed(3)));
  if (el.style.opacity !== opacity) el.style.opacity = opacity;
}

function refreshHUD() {
  if (!state) return;
  renderCombatFeedback();
  const bonuses = String(state.players.some(p => p.alive && (p.rapidFireTime > 0 || p.invulnerableTime > 0)));
  if (document.body.dataset.bonuses !== bonuses) document.body.dataset.bonuses = bonuses;
  setText($('level-name'), environment(state.level).name);
  setText($('level-number'), `${String(state.level + 1).padStart(2, '0')} · Cycle ${campaignCycle(state.level) + 1}`);
  setText($('difficulty-value'), difficultyProfile(state.difficulty).label);
  setText($('wave-label'), waveLabel(state));
  // Endless runs keep the instrument width stable; exact totals remain
  // available to assistive technology and on hover.
  for (const [id, value, label] of [['score-value', state.score, 'score'], ['credits-value', state.credits, 'credits']]) {
    const el = $(id), exact = `${number(value)} ${label}`;
    setText(el, rewardNumber(value)); setAttribute(el, 'title', exact); setAttribute(el, 'aria-label', exact);
  }
  const pilot = state.players[0], profile = primaryStats(state, pilot);
  const stats = shipStats(state.upgrades);
  setText($('weapon-value'), profile.name); setText($('weapon-level'), `P${profile.power + 1} · Mk ${String(profile.level + 1).padStart(2, '0')}`);
  const pips = $('p1-power').children, power = pilot.power || 0;
  for (let i = 0; i < pips.length; i++) { pips[i].classList.toggle('on', i <= power); pips[i].classList.toggle('max', power >= MAX_POWER); }
  setAttribute($('p1-power'), 'aria-label', `Power ${power + 1} of ${MAX_POWER + 1}`);
  for (const [id, value] of [['p1-bombs', pilot.bombs || 0], ['p1-drones', pilot.drones || 0], ['p1-lives', state.lives || 0]]) {
    const text = String(value), el = $(id);
    if (el.textContent !== text) { if (el.textContent) flash(el.parentElement); el.textContent = text; }
  }
  setText($('p1-reserve'), state.lives === 1 ? '1 ship in reserve' : `${state.lives || 0} ships in reserve`);
  setText($('touch-bomb-count'), String(pilot.bombs || 0));
  setFill($('progress-fill'), directorProgress(state));
  for (const p of state.players) {
    const prefix = `p${p.id + 1}`;
    setFill($(prefix + '-energy'), p.fireEnergy / stats.energy);
    setAttribute($(prefix + '-energy').parentElement, 'aria-label', `Pilot ${p.id + 1} fire energy ${Math.floor(p.fireEnergy)} of ${stats.energy}${p.fireEnergyLocked ? ', recharging' : ''}`);
    const energyPercent = Math.floor(p.fireEnergy / stats.energy * 100);
    const energyStatus = !p.alive ? 'Offline' : p.fireEnergyLocked ? `Recharging · ${energyPercent}%` : `${energyPercent}%`;
    setText($(prefix + '-energy-status'), energyStatus);
    setAttribute($(prefix + '-energy-line'), 'data-depleted', String(p.fireEnergyLocked));
    setFill($(prefix + '-hull'), p.hull / p.maxHull); setFill($(prefix + '-shield'), p.shield / p.maxShield);
    setAttribute($(prefix + '-hull').parentElement, 'aria-label', `Pilot ${p.id + 1} hull ${Math.ceil(p.hull)} of ${p.maxHull}`);
    setAttribute($(prefix + '-shield').parentElement, 'aria-label', `Pilot ${p.id + 1} shield ${Math.ceil(p.shield)} of ${p.maxShield}`);
    const rapid = p.alive ? p.rapidFireTime || 0 : 0, invulnerable = p.alive ? p.invulnerableTime || 0 : 0;
    setHidden($(prefix + '-bonuses'), rapid <= 0 && invulnerable <= 0);
    for (const [kind, remaining] of [['rapid', rapid], ['invulnerable', invulnerable]]) {
      setHidden($(prefix + '-' + kind), remaining <= 0);
      setText($(prefix + '-' + kind + '-time'), `${Math.ceil(remaining)}s`);
    }
  }
  const challenge = state.challenge && !state.challenge.done;
  setHidden($('challenge-hud'), !challenge);
  if (challenge) setText($('challenge-count'), `${state.challenge.hits} / ${state.challenge.total} hits`);
  const boss = state.enemies.find(e => e.boss && !e.dead);
  setHidden($('boss-hud'), !boss || !!challenge);
  if (boss) {
    setText($('boss-name'), environment(state.level).bossName || 'Sector guardian'); setFill($('boss-fill'), boss.hp / boss.maxHp);
    setText($('boss-status'), boss.vulnerable ? `Core exposed · ${boss.windowClock.toFixed(1)}s` : `Armor sealed · ${boss.windowClock.toFixed(1)}s`);
    $('boss-hud').classList.toggle('exposed', !!boss.vulnerable);
  }
}

function showHangar(bonus, loading = false) {
  const next = nextSector(state.level);
  if (activeCampaign) unlocked = Math.max(unlocked, next);
  setScreen('hangar'); $('announcement').hidden = true;
  $('hangar-title').textContent = 'Refit your ship.';
  $('hangar-subtitle').textContent = `${environment(state.level).name} cleared · ${sectorLabel(state.level)} · ${state.kills} ship${state.kills === 1 ? '' : 's'} down · ${state.destroyed} buildings destroyed.${bonus ? ` ${number(bonus)} credits awarded.` : ''} ${environmentIndex(state.level) === 9 ? 'A new cycle awaits with stronger enemies and richer rewards.' : 'Spend your salvage before the next launch.'}`;
  renderReport();
  $('next-button').textContent = `Launch sector ${String(next + 1).padStart(2, '0')} — ${environment(next).name}  ↗`;
  const routeStart = campaignCycle(next) * WORLDS.length;
  $('campaign-route').setAttribute('aria-label', `Cycle ${campaignCycle(next) + 1} flight path`);
  $('campaign-route').innerHTML = WORLDS.map((world, index) => {
    const sector = routeStart + index, complete = sector >= (state.startLevel || 0) && sector <= state.level, current = sector === next;
    return `<li class="${complete ? 'complete' : current ? 'current' : ''}" ${current ? 'aria-current="step"' : ''}><span>${String(sector + 1).padStart(2, '0')}${complete ? ' ✓' : ''}</span><strong>${world.name}</strong></li>`;
  }).join('');
  renderUpgrades(); $('next-button').focus({ preventScroll: true });
  if (!loading) autosave();
  // Prepare the next world and fleet while the shop is on screen, not at launch.
  // The cleared world's destruction ledger is no longer needed after its guardian.
  const prepareNext = () => {
    if (scene !== 'hangar' || !state || nextSector(state.level) !== next) return;
    warmFleet(next); world.setWorld(next, sectorSeed(next)); world.prepare(W, H);
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(prepareNext);
  else setTimeout(prepareNext, 0);
}

// Galaga-style results: shots, hits and ratio, plus this campaign's extras.
function renderReport() {
  const stats = state.stats || {}, shots = stats.shots || 0, hits = stats.hits || 0;
  const ratio = shots ? `${(hits / shots * 100).toFixed(1)}%` : '—';
  const challenge = state.challenge?.done ? state.challenge : null;
  const perfect = challenge && challenge.hits >= challenge.total;
  $('hangar-report').innerHTML = `<div><dt>Hit ratio</dt><dd>${ratio}<small>${number(hits)} hits · ${number(shots)} shots</small></dd></div><div><dt>Squadrons wiped</dt><dd>${stats.squads || 0}</dd></div><div><dt>Dive kills</dt><dd>${stats.dives || 0}<small>${stats.rescues ? `${stats.rescues} drone${stats.rescues === 1 ? '' : 's'} rescued` : 'Worth double points'}</small></dd></div><div><dt>Challenging stage</dt><dd class="${perfect ? 'perfect' : ''}">${challenge ? `${challenge.hits} / ${challenge.total}` : '—'}<small>${challenge ? (perfect ? 'Perfect!' : `+${number(challenge.credits || 0)} credits`) : 'After odd sectors'}</small></dd></div>`;
  $('hangar-report-note').textContent = environment(state.level).name;
}

function renderUpgrades() {
  $('hangar-credits').textContent = number(state.credits);
  const stats = shipStats(state.upgrades), weapon = primaryStats(state);
  $('hangar-loadout').innerHTML = `<div><dt>Hull capacity</dt><dd>${stats.hull}</dd></div><div><dt>Shield capacity</dt><dd>${stats.shield}</dd></div><div><dt>Fire energy</dt><dd>${stats.energy}<small>${stats.energyRecharge}/s · ${stats.energyDelay.toFixed(1)}s delay</small></dd></div><div><dt>Armament</dt><dd>Mk ${weapon.level + 1}<small>${weapon.name} · power ${weapon.power + 1}</small></dd></div>`;
  $('upgrade-list').innerHTML = UPGRADES.map(u => {
    const level = state.upgrades[u.id], maxed = level >= MAX_UPGRADE, cost = upgradeCost(state, u.id);
    const next = { ...state, upgrades: { ...state.upgrades, [u.id]: Math.min(MAX_UPGRADE, level + 1) } }, upgraded = shipStats(next.upgrades), nextWeapon = primaryStats(next);
    const preview = u.id === 'fireRate' ? `${(1 / firingInterval(weapon)).toFixed(2)} → ${(1 / firingInterval(nextWeapon)).toFixed(2)} volleys/s`
      : u.id === 'firePower' ? `${weapon.damage.toFixed(2)} → ${nextWeapon.damage.toFixed(2)} shot damage`
      : u.id === 'weapon' ? `${weapon.damage.toFixed(1)} → ${nextWeapon.damage.toFixed(1)} damage · ${(1 / firingInterval(nextWeapon)).toFixed(2)} volleys/s`
      : u.id === 'recharge' ? `${stats.recharge} → ${upgraded.recharge} shield/s · ${stats.energyRecharge} → ${upgraded.energyRecharge} energy/s`
      : `${stats[u.id]} → ${upgraded[u.id]} ${u.id}`;
    return `<button class="upgrade-card" data-upgrade="${u.id}" ${maxed || state.credits < cost ? 'disabled' : ''}>${shopArtMarkup(`upgrade:${u.id}`)}<span class="upgrade-level">Mk ${String(level + 1).padStart(2, '0')} / ${String(MAX_UPGRADE + 1).padStart(2, '0')}</span><span class="upgrade-name">${u.name}</span><span class="upgrade-description">${u.subtitle}</span><span class="upgrade-preview">${maxed ? 'Maximum performance reached' : preview}</span><span class="upgrade-pips" aria-hidden="true">${Array.from({ length: MAX_UPGRADE }, (_, i) => `<i class="${i < level ? 'filled' : ''}"></i>`).join('')}</span><span class="upgrade-cost">${maxed ? 'Fully upgraded' : `${number(cost)} credits <span aria-hidden="true">+</span>`}</span></button>`;
  }).join('');
  renderWeapons(); renderSupplies();
}

function renderSupplies() {
  $('supply-list').innerHTML = SUPPLIES.map(item => {
    const [stock, max] = supplyStock(state, item.id), cost = supplyCost(state, item.id), full = stock >= max;
    const label = item.id === 'life' ? 'reserve ships' : item.id === 'bomb' ? 'charges' : 'drones';
    return `<button class="upgrade-card" data-supply="${item.id}" ${full || state.credits < cost ? 'disabled' : ''}>${shopArtMarkup(`supply:${item.id}`)}<span class="upgrade-level">${stock} / ${max} ${label}</span><span class="upgrade-name">${item.name}</span><span class="upgrade-description">${item.subtitle}</span><span class="upgrade-cost">${full ? 'Fully stocked' : `${number(cost)} credits <span aria-hidden="true">+</span>`}</span></button>`;
  }).join('');
}

const WEAPON_ICONS = { pulse: 'Ⅱ', scatter: '⋔', lance: '|', plasma: '◉' };
function weaponBars(stats, count, fastestInterval) {
  const power = Math.round(Math.min(100, stats.damage * count * 1.18));
  const speed = Math.round(Math.min(100, 100 * fastestInterval / firingInterval(stats)));
  const range = Math.round(Math.min(100, stats.speed * stats.life / 12));
  return `<span class="weapon-bars" aria-label="Power ${power}, fire rate ${speed}, reach ${range}"><i style="--bar:${power}%"></i><i style="--bar:${speed}%"></i><i style="--bar:${range}%"></i></span><span class="weapon-readout"><b>${stats.damage.toFixed(1)} damage${count > 1 ? ` × ${count}` : ''}</b><b>${(1 / firingInterval(stats)).toFixed(2)} / s</b></span>`;
}
function renderWeapons() {
  const fastestInterval = firingInterval(weaponStats(state, 'pulse'));
  const primaries = PRIMARIES.map(weapon => {
    const owned = state.owned?.includes(weapon.id), equipped = state.primary === weapon.id;
    const stats = primaryStats({ ...state, primary: weapon.id });
    const status = equipped ? 'Equipped · space' : owned ? 'Owned · click to equip' : `${number(weapon.cost)} credits to buy`;
    const disabled = !owned && state.credits < weapon.cost;
    return `<button type="button" class="weapon-card" data-primary="${weapon.id}" data-state="${equipped ? 'equipped' : owned ? 'owned' : 'shop'}" aria-pressed="${equipped}" style="--weapon-color:${weapon.color}" ${disabled ? 'disabled' : ''}>${shopArtMarkup(`weapon:${weapon.id}`)}<span class="weapon-copy"><strong>${weapon.name}</strong><small>Primary · ${weapon.tag}</small></span><span class="weapon-description">${weapon.description}</span>${weaponBars(stats, stats.count, fastestInterval)}<span class="weapon-status">${status}</span></button>`;
  });
  const plasma = WEAPONS[1], stats = weaponStats(state, 'plasma');
  primaries.push(`<article class="weapon-card" data-weapon="plasma" data-state="equipped" style="--weapon-color:${plasma.color}">${shopArtMarkup('weapon:plasma')}<span class="weapon-copy"><strong>${plasma.name}</strong><small>Secondary · q</small></span><span class="weapon-description">${plasma.description} ${SECONDARY_ENERGY_COST} energy per shot; resumes at ${SECONDARY_RESTART_ENERGY} after depletion.</span>${weaponBars(stats, 1, fastestInterval)}<span class="weapon-status">Always equipped</span></article>`);
  $('weapon-list').innerHTML = primaries.join('');
}

function showEnd(won, loading = false) {
  if (won) { showHangar(0, loading); return; }
  setScreen('end'); $('announcement').hidden = true;
  $('end-title').textContent = 'Signal lost.';
  $('end-description').textContent = `Your flight ended over ${environment(state.level).name} · ${sectorLabel(state.level)}. Retry with your current equipment or return to the main menu.${activeCampaign && campaign.run ? ' Your last autosave is ready to resume.' : ''}`;
  $('end-score').textContent = number(state.score);
  const record = !loading && recordBestScore();
  $('end-best').hidden = !bestScore;
  $('end-best').classList.toggle('record', record);
  $('end-best').textContent = record ? 'New best score!' : `Best score ${number(bestScore)}`;
  $('retry-button').textContent = 'Retry sector ↗';
  refreshContinue();
  $('retry-button').focus({ preventScroll: true });
}

function refreshContinue() {
  const run = campaign.run, error = campaignError || campaign.error;
  $('continue-button').hidden = false; $('continue-button').disabled = !run;
  setText($('continue-label'), 'Resume campaign');
  const status = campaignError ? 'Could not autosave in this browser. Your previous save is unchanged; you can keep playing.'
    : error === 'unavailable' ? 'Browser storage is unavailable. You can still play.'
    : error === 'corrupt' ? 'The saved campaign could not be read. You can start a new campaign.'
    : run ? `${saveDescription(run)} · ${number(run.state.credits)} credits · ${number(run.state.score)} score. Progress saves automatically.`
    : 'Progress saves automatically in this browser. Start a new campaign to begin.';
  saveStatus(bestScore ? `${status} Best score ${number(bestScore)}.` : status);
  if (state && !activeCampaign) {
    for (const id of ['pause-save-status', 'hangar-save-status']) setText($(id), 'Practice flight · Your campaign stays saved.');
  }
}

function saveDescription(run) {
  return `${sectorLabel(run.state.level)} · ${difficultyProfile(run.state.difficulty).label} · ${run.scene === 'hangar' ? 'Shop' : 'Flight'}`;
}

function selectWorld(index) {
  selected = clamp(Math.floor(Number(index) || 0), 0, WORLDS.length - 1); world.setWorld(selected); previewScroll = 0;
  world.prepare(W, H); warmFleet(selected);
  document.documentElement.style.setProperty('--sector-accent', WORLDS[selected].accent || WORLDS[selected].color);
  $('world-list').querySelectorAll('[data-world]').forEach((button, i) => { button.classList.toggle('active', i === selected); button.setAttribute('aria-pressed', String(i === selected)); });
  for (const id of ['selected-world-name', 'preview-world-name']) if ($(id)) $(id).textContent = WORLDS[selected].name;
  if ($('selected-world-description')) $('selected-world-description').textContent = WORLDS[selected].description || WORLDS[selected].subtitle;
  if ($('preview-world-number')) $('preview-world-number').textContent = `Sector ${String(selected + 1).padStart(2, '0')}`;
  document.body.dataset.world = selected;
  $('sector-flight-button').textContent = `Practice sector ${String(selected + 1).padStart(2, '0')} ↗`;
  renderDirty = true; requestFrame();
}

function input() {
  controls[0].x = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touch.x;
  controls[0].y = Number(keys.has('KeyS')) - Number(keys.has('KeyW')) + touch.y;
  controls[0].fire = keys.has('Space') || touch.fire;
  controls[0].secondary = keys.has('KeyQ') || touch.secondary;
  controls[0].bomb = keys.has('KeyE') || touch.bomb;
  return controls;
}

const WAVE_BRIEFS = {
  hive: ['Swarm inbound', 'Shoot them as they fly in. Divers are worth double.'],
  sweep: ['Strike squadrons', 'Destroy a whole squadron before it escapes for a bonus.'],
  gunship: ['Gunships', 'Lancers paint a firing line before the beam. Leave the line.'],
  formation: ['Tactical formations', 'Break the formation before it passes.'],
};
function processEvents() {
  const groundOffset = world.parallaxX || 0;
  const events = state.events.length ? state.events.splice(0) : state.events;
  for (const e of events) {
    fx.emit(e, state.scroll, groundOffset);
    const sound = e.type === 'pickup' && (e.bonus === 'power' || e.bonus === 'drone') ? e.bonus : e.type;
    audio.effect(sound, e.size ?? e.wave, e.type === 'challenge-result' && e.perfect ? 'perfect' : e.weapon || e.label);
    if (e.type === 'explosion' && !e.ground) {
      const blast = e.blast || 1;
      for (const prop of environmentHit(e.x, e.y, Math.min(250, e.size * 1.5 * blast), e.size * 2 * blast, state.scroll)) {
        applyGroundReward(state, prop, blast);
      }
      if (e.boss) hitstop = Math.max(hitstop, .14);
      else if (e.player) hitstop = Math.max(hitstop, .16);
      else if (e.midboss) hitstop = Math.max(hitstop, .09);
    }
    if (e.type === 'nova') {
      hitstop = Math.max(hitstop, .08);
      for (const prop of environmentHit(e.x, e.y, 320, 420, state.scroll)) applyGroundReward(state, prop, 1.2);
    }
    if (e.type === 'boss') announce('Warning · heavy signature', environment(state.level).bossName, 'Break through its armor. Watch for changing attack patterns.', 3);
    if (e.type === 'phase') announce('Reactor surge', 'Guardian enraged', 'New attack pattern detected.', 1.6, true);
    if (e.type === 'boss-open' && e.openCount === 1) announce('Window open', 'Core exposed', 'Aim for the glowing weak points before the armor seals.', 1.5, true);
    if (e.type === 'formation' && !state.director) announce('Tactical formation', e.label, `${e.count} contacts moving as one.`, 1.15, true);
    if (e.type === 'wave' && e.wave > 1 && WAVE_BRIEFS[e.kind]) announce(`Wave ${String(e.wave).padStart(2, '0')} / ${String(e.total).padStart(2, '0')}`, ...WAVE_BRIEFS[e.kind], 1.8, true);
    if (e.type === 'midboss') announce('Warning · heavy cruiser', 'Dreadnought', 'Destroy it for a power core and a wing drone.', 2.4);
    if (e.type === 'captor') announce('Warning · captor', 'Tractor beam', 'It steals wing drones. Shoot it down to bring them home.', 2.6);
    if (e.type === 'captured') announce('Drone captured', 'Shoot the captor', 'Destroy it before it escapes to rescue your drone.', 2, true);
    if (e.type === 'captive-lost') announce('Captor escaped', 'Drone lost', '', 1.4, true);
    if (e.type === 'challenge') announce('Bonus stage', 'Challenging stage', `${e.total} ships. No return fire. Hit every one for a perfect bonus.`, 3);
    if (e.type === 'challenge-result') announce(e.perfect ? 'Perfect!' : 'Challenge complete', `${e.hits} / ${e.total}`, `+${number(e.credits)} credits · +${number(e.score)} score`, 2.6);
    if (e.type === 'extra-life') announce('Extra ship', e.credits ? `+${e.credits} credits` : '1UP', e.credits ? 'Reserve hangar full.' : `${e.lives} ship${e.lives === 1 ? '' : 's'} in reserve.`, 1.8, true);
    if (e.type === 'respawn') announce('Reserve ship launched', `${e.lives} left`, 'Two power levels and one drone lost.', 1.6, true);
    if (e.type === 'weapon') { refreshHUD(); renderWeapons(); }
    if (['pickup', 'extra-life', 'respawn', 'nova', 'captured', 'rescue', 'power-lost'].includes(e.type)) refreshHUD();
    if (e.type === 'hangar') showHangar(e.bonus);
    if (e.type === 'defeat') showEnd(false);
    if (e.type === 'victory') showEnd(true);
    // Collateral destruction can add ground effects even on the final tick.
    if (state.events.length) events.push(...state.events.splice(0));
  }
  feedback.collect(state, events);
  renderCombatFeedback();
  // Save at a bounded cadence, after combat and reward events have settled.
  if (scene === 'playing' && activeCampaign && state.time - lastAutosaveTime >= 5) autosave();
}

const DRONE_COLOR = '#ffc46b', CAPTIVE_COLOR = '#ff7a8a';
let pilotBarrier = null;
function pilotBarrierTexture() {
  if (pilotBarrier) return pilotBarrier;
  const out = document.createElement('canvas'); out.width = 128; out.height = 160;
  const paint = out.getContext('2d');
  paint.translate(64, 80); paint.strokeStyle = '#baffdb'; paint.lineWidth = 2;
  paint.shadowColor = '#6affc5'; paint.shadowBlur = 10; paint.fillStyle = '#82ffcb0a';
  paint.beginPath(); paint.moveTo(0, -58); paint.lineTo(44, -30); paint.lineTo(44, 30);
  paint.lineTo(0, 58); paint.lineTo(-44, 30); paint.lineTo(-44, -30); paint.closePath(); paint.fill(); paint.stroke();
  paint.shadowBlur = 0; paint.globalAlpha = .38; paint.lineWidth = 1;
  paint.beginPath(); paint.ellipse(0, 0, 37, 48, 0, 0, Math.PI * 2); paint.stroke();
  pilotBarrier = out; return out;
}

function drawPilotBonuses(p, x, y) {
  const invulnerable = p.invulnerableTime || 0, rapid = p.rapidFireTime || 0;
  if (!invulnerable && !rapid) return;
  ctx.save();
  if (invulnerable > 0) {
    ctx.globalAlpha = fx.reduced ? .8 : invulnerable < 2 ? .5 + Math.sin(clock * 10) * .22 : .78 + Math.sin(clock * 3) * .1;
    ctx.drawImage(pilotBarrierTexture(), x - 64, y - 80);
  }
  if (rapid > 0) {
    ctx.globalAlpha = fx.reduced ? .8 : .72 + Math.sin(clock * 6) * .16;
    ctx.strokeStyle = BONUS_PALETTE.rim; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(x + side * 26, y + 14);
      ctx.lineTo(x + side * 32, y + 6); ctx.lineTo(x + side * 38, y + 14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + side * 26, y + 23);
      ctx.lineTo(x + side * 32, y + 15); ctx.lineTo(x + side * 38, y + 23); ctx.stroke();
    }
  }
  ctx.restore();
}

// Squadrons about to sweep in from a screen edge are announced by a chevron,
// so a low side entry never arrives unseen.
function drawEntryWarnings() {
  const lanes = new Map();
  for (const e of state.enemies) {
    if (!isDormant(e) || e.dead) continue;
    const eta = -e.pathD / e.pathSpeed;
    if (eta > 1.1) continue;
    const side = e.x < 0 ? -1 : e.x > W ? 1 : 0;
    if (!side) continue;
    const key = `${side}:${Math.round(e.y / 40)}`;
    if (!lanes.has(key) || lanes.get(key).eta > eta) lanes.set(key, { side, y: e.y, eta });
  }
  if (!lanes.size) return;
  ctx.save(); ctx.fillStyle = '#ff9a7a'; ctx.shadowColor = '#ff5d3a'; ctx.shadowBlur = 12;
  for (const { side, y, eta } of lanes.values()) {
    const x = side < 0 ? 22 : W - 22, pulse = fx.reduced ? 1 : .7 + .3 * Math.sin(clock * 16);
    ctx.globalAlpha = Math.min(1, .35 + (1.1 - eta) * 1.6) * pulse;
    for (let i = 0; i < 3; i++) {
      const cx = x - side * i * 15;
      ctx.beginPath(); ctx.moveTo(cx + side * 11, y - 16); ctx.lineTo(cx - side * 6, y); ctx.lineTo(cx + side * 11, y + 16);
      ctx.lineTo(cx + side * 4, y); ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// Galaga's tractor beam: a cone of bright rings climbing toward the captor.
function drawTractor(e) {
  const x = lerp(e.px, e.x), y = lerp(e.py, e.y), apexY = y + e.radius * .55, depth = H - apexY;
  if (depth <= 0) return;
  const charge = e.capState === 1, half = 26 + depth * .3;
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  const gradient = ctx.createLinearGradient(0, apexY, 0, H);
  gradient.addColorStop(0, charge ? '#ff9ad066' : '#a8dcffaa'); gradient.addColorStop(1, '#a8dcff00');
  ctx.globalAlpha = charge ? (fx.reduced ? .4 : .25 + .25 * Math.sin(clock * 34)) : .7;
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(x - 26, apexY); ctx.lineTo(x + 26, apexY); ctx.lineTo(x + half, H); ctx.lineTo(x - half, H); ctx.closePath(); ctx.fill();
  if (!charge) {
    ctx.strokeStyle = '#e6f6ff'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const t = ((fx.reduced ? 0 : clock * 1.5) + i / 9) % 1, ringY = H - t * depth, width = 26 + (ringY - apexY) * .3;
      ctx.globalAlpha = .55 * Math.sin(t * Math.PI);
      ctx.beginPath(); ctx.ellipse(x, ringY, width, Math.max(3, width * .16), 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawCaptive(e, x, y) {
  const dy = y + e.radius + 24, pulse = fx.reduced ? 1 : .75 + .25 * Math.sin(clock * 7);
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .55; ctx.strokeStyle = '#a8dcff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y + e.radius * .5); ctx.lineTo(x, dy - 10); ctx.stroke();
  ctx.globalAlpha = .5 * pulse; ctx.strokeStyle = CAPTIVE_COLOR; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(x, dy, 26, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  // The captured drone hangs upside down beneath its captor, as in the arcade.
  ctx.save(); ctx.translate(x, dy); ctx.scale(1, -1);
  drawShip(ctx, 0, 0, 19, 'player', CAPTIVE_COLOR, clock, { world: state.level, quality, motion: !fx.reduced });
  ctx.restore();
}

// Divers leave a short luminous streak so their swoop reads at a glance.
function drawDiveStreak(e, x, y, palette) {
  const speed = Math.hypot(e.vx, e.vy);
  if (speed < 120) return;
  const length = Math.min(90, speed * .09), ux = e.vx / speed, uy = e.vy / speed;
  const gradient = ctx.createLinearGradient(x, y, x - ux * length, y - uy * length);
  gradient.addColorStop(0, `${palette?.glow || '#ff7866'}99`); gradient.addColorStop(1, `${palette?.glow || '#ff7866'}00`);
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.strokeStyle = gradient; ctx.lineCap = 'round';
  ctx.lineWidth = e.radius * 1.1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * length, y - uy * length); ctx.stroke();
  ctx.restore();
}

// Lancer beams: a pulsing dashed line while aiming, then a short heavy beam.
function drawBeams() {
  if (!state.beams?.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.lineCap = 'round';
  for (const beam of state.beams) {
    const owner = state.enemies.find(enemy => enemy.id === beam.owner && !enemy.dead);
    if (!owner) continue;
    const x = lerp(owner.px, owner.x) + beam.dx, y = lerp(owner.py, owner.y) + beam.dy;
    const ex = x + Math.cos(beam.angle) * 2200, ey = y + Math.sin(beam.angle) * 2200;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
    if (beam.t < beam.warn) {
      const k = beam.t / beam.warn;
      ctx.setLineDash([12, 9]); ctx.lineDashOffset = fx.reduced ? 0 : -clock * 90;
      ctx.strokeStyle = '#ff6b9a'; ctx.lineWidth = 1.5 + k * 2.5;
      ctx.globalAlpha = .3 + .55 * k * (fx.reduced ? 1 : .65 + .35 * Math.sin(clock * 38)); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const k = clamp(1 - (beam.t - beam.warn) / .42, 0, 1);
      ctx.strokeStyle = '#ff4d86'; ctx.lineWidth = 40 * k; ctx.globalAlpha = .3 * k; ctx.stroke();
      ctx.strokeStyle = '#ffc2d6'; ctx.lineWidth = 16 * k; ctx.globalAlpha = .85 * k; ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5 * k; ctx.globalAlpha = k; ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBossWeakPoints(enemy, clock) {
  if (!enemy.boss || !enemy.vulnerable) return;
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (const point of enemy.weakPoints || []) {
    if (!point.alive) continue;
    const position = bossWeakPointPosition(enemy, point), pulse = .82 + Math.sin(clock * 8 + point.index) * .18;
    ctx.save(); ctx.translate(position.x, position.y); ctx.rotate(clock * .8 + point.index);
    ctx.globalAlpha = .22 * pulse; ctx.fillStyle = '#ffd66e'; ctx.beginPath(); ctx.arc(0, 0, point.radius * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .92; ctx.strokeStyle = '#fff1a6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, point.radius, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-point.radius * 1.5, 0); ctx.lineTo(point.radius * 1.5, 0); ctx.moveTo(0, -point.radius * 1.5); ctx.lineTo(0, point.radius * 1.5); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function draw() {
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  const scroll = state ? lerp(previousScroll, state.scroll) : previewScroll, index = environmentIndex(state ? state.level : selected);
  ctx.save();
  const impactMotion = scene === 'playing' || scene === 'end';
  const shake = fx.reduced || !impactMotion ? 0 : fx.shake;
  if (shake > .3) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
  let focusX = 0, focusPilots = 0;
  for (const pilot of state?.players || []) if (pilot.alive) { focusX += lerp(pilot.px, pilot.x); focusPilots++; }
  focusX = focusPilots ? focusX / focusPilots : W * .66;
  world.draw(ctx, W, H, scroll, clock, quality, focusX, !fx.reduced);
  fx.drawGround(ctx, scroll, H, world.parallaxX || 0);
  if (state) {
    if (state.formations?.length) {
      ctx.save(); ctx.globalAlpha = .16; ctx.strokeStyle = SHIP_PALETTES[index]?.rim || '#e7f79a'; ctx.lineWidth = 1; ctx.setLineDash([4, 9]);
      for (const formation of state.formations) {
        let members = 0; ctx.beginPath();
        for (const enemy of state.enemies) if (enemy.formation === formation && !enemy.dead) {
          const x = lerp(enemy.px, enemy.x), y = lerp(enemy.py, enemy.y);
          if (members++) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        if (members > 1) ctx.stroke();
      }
      ctx.restore();
    }
    drawEntryWarnings();
    for (const e of state.enemies) if (e.ai === 'captor' && (e.capState === 1 || e.capState === 2) && !e.dead) drawTractor(e);
    drawBeams();
    for (const e of state.enemies) {
      if (isDormant(e)) continue;
      const x = lerp(e.px, e.x), y = lerp(e.py, e.y);
      if (y < -e.radius * 2 || y > H + e.radius * 2 || x < -e.radius * 2 || x > W + e.radius * 2) continue;
      const palette = SHIP_PALETTES[index];
      if (e.captive) drawCaptive(e, x, y);
      if (e.ai === 'dive' && !fx.reduced) drawDiveStreak(e, x, y, palette);
      drawShip(ctx, x, y, e.radius * (e.type < 2 ? 1.35 : 1), e.type, palette?.primary || WORLDS[index].enemyColor || '#b07355', clock, { hit: e.hurt / .07 * .3, phase: e.phase, world: index, quality, thrust: e.thrust, palette, motion: !fx.reduced });
      drawBossWeakPoints(e, clock);
      // Damaged heavy craft retain their local health readout; bosses use the HUD.
      if (!e.boss && !e.dead && e.hp > 0 && e.hp < e.maxHp && e.radius >= 24) {
        ctx.fillStyle = '#09171aca'; ctx.fillRect(x - e.radius, y - e.radius * 1.6 - 8, e.radius * 2, 3);
        ctx.fillStyle = '#fb9f7c'; ctx.fillRect(x - e.radius, y - e.radius * 1.6 - 8, e.radius * 2 * Math.max(0, e.hp / e.maxHp), 3);
      }
    }
    for (const pickup of state.pickups) {
      const pulse = fx.reduced ? 0 : Math.sin(clock * 3 + pickup.age);
      const size = 76 + pulse * 2;
      // Pickups about to expire blink so a pilot knows to hurry.
      if (pickup.age > 11.5 && !fx.reduced && Math.floor(clock * 10) % 2) continue;
      ctx.globalAlpha = pickup.lock > 0 ? .55 : 1;
      ctx.drawImage(pickupTexture(pickup.kind), pickup.x - size / 2, pickup.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
    drawProjectiles(ctx, state.bullets, renderAlpha, W, H);
    for (const p of state.players) if (p.alive) {
      const color = '#a4ffee', x = lerp(p.px, p.x), y = lerp(p.py, p.y);
      for (const drone of p.wing || []) drawShip(ctx, lerp(drone.px, drone.x), lerp(drone.py, drone.y), 17, 'player', DRONE_COLOR, clock, { world: index, thrust: p.thrust, quality, motion: !fx.reduced });
      const guard = p.guard > 0;
      // A freshly launched ship blinks while its launch shield holds.
      if (!guard || fx.reduced || Math.floor(clock * 14) % 3) drawShip(ctx, x, y, 30, 'player', color, clock, { hit: p.hurt > .2 ? 1 : 0, player: p.id, world: index, thrust: p.thrust, quality, motion: !fx.reduced });
      if (guard) {
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = Math.min(1, p.guard) * .7;
        ctx.strokeStyle = '#e7fff8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 44 + Math.sin(clock * 9) * 2, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      if (p.shield > 1) {
        ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = .08 + p.shield / p.maxShield * .13 + (p.hurt > 0 ? .45 : 0);
        ctx.beginPath(); ctx.ellipse(0, 0, 37, 46, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha *= .36; ctx.fillStyle = color; ctx.fill(); ctx.restore();
      }
      drawPilotBonuses(p, x, y);
    }
  } else {
    const px = W * .66 + (fx.reduced ? 0 : Math.sin(clock * .5) * 45), py = H * .57 + (fx.reduced ? 0 : Math.cos(clock * .8) * 15);
    drawShip(ctx, px, py, 45, 'player', '#9bfff0', clock, { world: index, quality, motion: !fx.reduced });
    drawShip(ctx, px + 145, py + 115, 25, 'player', '#ffd0a0', clock, { world: index, quality, motion: !fx.reduced });
  }
  fx.draw(ctx, W, H);
  ctx.restore();
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  // Brief defocus belongs to the flight canvas, keeping menus and HUD text sharp.
  const blur = quality === 'high' && !fx.reduced && impactMotion
    ? Math.max(fx.damagePulse * 1.65, fx.shake > 8 ? Math.min(.85, fx.shake * .045) : 0) : 0;
  const blurTenths = Math.round(blur * 10);
  const filter = blurTenths ? `blur(${(blurTenths / 10).toFixed(1)}px)` : '';
  if (canvas.style.filter !== filter) canvas.style.filter = filter;
}

function frame(time) {
  frameHandle = 0;
  if (document.hidden) { lastTime = 0; return; }
  const elapsed = lastTime ? Math.max(0, (time - lastTime) / 1000) : 0;
  const dt = Math.min(.1, elapsed); lastTime = time;
  const preview = scene === 'menu' && document.body.dataset.preview === 'true';
  const fading = scene === 'end' && (fx.particles.length || fx.rings.length || fx.delayed.length || fx.lights.length || fx.flares.length || fx.damagePulse > .02 || fx.flash > .01 || fx.shake > .3);
  const active = scene === 'playing' || preview || fading;
  if (active) clock += dt;
  if (scene === 'playing' && state) {
    const started = performance.now();
    // A brief freeze on heavy kills sells the impact. The accumulator is held,
    // not cleared, so interpolation keeps drawing the same instant until it ends.
    if (hitstop > 0) hitstop = Math.max(0, hitstop - dt);
    else accumulator = Math.min(.1, accumulator + dt);
    while (hitstop <= 0 && accumulator + 1e-9 >= STEP && scene === 'playing') {
      previousScroll = state.scroll;
      update(state, STEP, input(), environmentHit);
      accumulator -= STEP; perf.steps++;
      processEvents();
      // Freezing mid catch-up keeps only a partial step, so resuming never bursts ahead.
      if (hitstop > 0) accumulator = Math.min(accumulator, STEP * .999);
    }
    renderAlpha = scene === 'playing' ? clamp(accumulator / STEP, 0, 1) : 1;
    perf.updateMs += (performance.now() - started - perf.updateMs) * .05;
    fx.update(dt); feedback.update(dt);
    if (elapsed > .006) {
      fastestFrame = Math.min(fastestFrame, elapsed * 1000);
      // A very slow frame still counts toward load; only simulation catch-up is capped.
      frameAverage += (Math.min(elapsed, .25) * 1000 - frameAverage) * .025;
      perf.frameMs = frameAverage; perf.fps = 1000 / frameAverage;
      const wallClock = time / 1000;
      // Reduce only backing resolution under sustained load; physics and game speed stay fixed.
      if (wallClock - lastAdapt > 4 && frameAverage > Math.max(25, fastestFrame * 1.55) && resolutionScale > .7) {
        resolutionScale = Math.max(.7, resolutionScale - .1); sizeSurface(canvas.getBoundingClientRect(), true); lastAdapt = wallClock;
      } else if (wallClock - lastAdapt > 12 && frameAverage < Math.max(18, fastestFrame * 1.15) && perf.renderMs < 7 && resolutionScale < 1) {
        resolutionScale = Math.min(1, resolutionScale + .05); sizeSurface(canvas.getBoundingClientRect(), true); lastAdapt = wallClock;
      }
    }
  } else if (preview) previewScroll += dt * 45;
  else if (fading) fx.update(dt);
  renderCombatFeedback();
  audio.update(scene === 'playing', state?.level || 0, state?.challenge && !state.challenge.done ? 'challenge' : state?.bossSpawned && !state.bossDefeated ? 'boss' : '');
  if (clock > announcementUntil && !$('announcement').hidden) $('announcement').hidden = true;
  if (scene === 'playing') { hudClock += dt; if (hudClock > .1) { refreshHUD(); hudClock = 0; } }
  if (active || renderDirty) {
    const started = performance.now(); draw();
    perf.renderMs += (performance.now() - started - perf.renderMs) * .05;
    perf.frames++; renderDirty = false;
  }
  if (active) requestFrame();
  else idleHandle = setTimeout(() => { idleHandle = 0; requestFrame(); }, 180);
}

const controlledKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ', 'KeyE']);
const capturedKeys = new Set();
const lockKeys = [...controlledKeys, 'Escape', 'KeyP', 'KeyV', 'KeyF', 'F11'];
function consumeInput(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}
function syncKeyboardLock() {
  const keyboard = navigator.keyboard;
  if (!keyboard?.lock) return;
  const epoch = ++keyboardLockEpoch;
  const wanted = () => scene === 'playing' && !!document.fullscreenElement && !document.hidden && document.hasFocus();
  if (!wanted()) { keyboard.unlock(); return; }
  // Fullscreen browsers can deliver additional reserved shortcuts. Permission
  // denial or lack of support leaves ordinary event capture available.
  keyboard.lock(lockKeys).then(() => {
    if (epoch !== keyboardLockEpoch && !wanted()) keyboard.unlock();
  }).catch(() => {});
}
window.addEventListener('keydown', event => {
  if (scene === 'playing') {
    // Tab opens accessible pause controls; all flight input stays in the arena.
    if (event.code === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      consumeInput(event); capturedKeys.add(event.code); pause(); return;
    }
    const pressed = !event.repeat && !capturedKeys.has(event.code);
    consumeInput(event); capturedKeys.add(event.code);
    if (controlledKeys.has(event.code)) {
      keys.add(event.code);
    } else if (pressed && (event.code === 'Escape' || event.code === 'KeyP')) pause();
    else if (pressed && event.code === 'KeyV') toggleSound();
    return;
  }
  const modal = [...document.querySelectorAll('.modal-screen')].reverse().find(el => !el.hidden);
  if (event.code === 'Tab' && modal) {
    const focusable = [...modal.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1), current = document.activeElement;
    if (!modal.contains(current) || (event.shiftKey && current === first) || (!event.shiftKey && current === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if ((event.code === 'Escape' || event.code === 'KeyP') && !event.repeat) {
    if (!$('help-screen').hidden || scene === 'pause') {
      consumeInput(event); capturedKeys.add(event.code);
      if (!$('help-screen').hidden) closeHelp(); else pause();
    }
  }
  if (event.code === 'KeyV' && !event.repeat) {
    consumeInput(event); capturedKeys.add(event.code); toggleSound();
  }
}, { capture: true, passive: false });
window.addEventListener('keyup', event => {
  keys.delete(event.code);
  if (capturedKeys.delete(event.code) || scene === 'playing') consumeInput(event);
}, { capture: true, passive: false });
window.addEventListener('keypress', event => {
  if (scene === 'playing' || capturedKeys.has(event.code)) consumeInput(event);
}, { capture: true, passive: false });
window.addEventListener('blur', () => { keys.clear(); capturedKeys.clear(); if (scene === 'playing') pause(); });
document.addEventListener('fullscreenchange', syncKeyboardLock);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && scene === 'playing') pause();
  if (!document.hidden) { lastTime = 0; renderDirty = true; requestFrame(); }
});
window.addEventListener('pagehide', autosave);
window.addEventListener('resize', resize);
// CSS docks, device rotation and browser chrome can resize the arena without
// changing the full window. Render and collide within its actual content box.
new ResizeObserver(syncArenaSize).observe(canvas);
for (const type of ['contextmenu', 'dragstart']) canvas.addEventListener(type, consumeInput);
canvas.addEventListener('wheel', event => { if (scene === 'playing') consumeInput(event); }, { passive: false });
// Clicking the arena only restores keyboard focus; flight uses keys or touch.
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || scene !== 'playing') return;
  canvas.focus({ preventScroll: true }); consumeInput(event);
});
function on(id, fn) { $(id)?.addEventListener('click', fn); }
$('difficulty-picker').addEventListener('change', event => {
  if (!event.target.matches('input[name="difficulty"]')) return;
  selectedDifficulty = normalizeDifficulty(event.target.value);
  try { localStorage.setItem('tyran-difficulty', selectedDifficulty); } catch { /* optional */ }
  refreshDifficultyChoice();
});
on('launch-button', () => launch(0));
on('sector-flight-button', () => launch(selected, null, false));
on('continue-button', resumeCampaign);
on('hangar-menu-button', returnToMenu);
on('pause-button', pause); on('resume-button', pause); on('menu-button', returnToMenu); on('end-menu-button', returnToMenu);
on('restart-button', () => launch(state.level, state, activeCampaign));
on('retry-button', () => launch(state.level, state, activeCampaign));
on('next-button', () => {
  if (state?.status !== 'hangar') return;
  beginLevel(state, nextSector(state.level)); selected = environmentIndex(state.level); world.setWorld(state.level, sectorSeed(state.level)); warmFleet(state.level); previousScroll = 0; fx.reset(); feedback.reset(state); setScreen('playing'); audio.start(); $('boss-hud').hidden = true;
  announce(sectorLabel(state.level), environment(state.level).name, environment(state.level).subtitle, 3); refreshHUD(); canvas.focus({ preventScroll: true });
  autosave();
});
$('weapon-list').addEventListener('click', event => {
  const button = event.target.closest('[data-primary]'); if (!button || !state) return;
  const id = button.dataset.primary, owned = state.owned.includes(id);
  if (state.primary === id) return;
  if (buyPrimary(state, id)) { audio.effect(owned ? 'weapon' : 'upgrade'); renderUpgrades(); autosave(); $('next-button').focus({ preventScroll: true }); }
});
$('supply-list').addEventListener('click', event => {
  const button = event.target.closest('[data-supply]'); if (!button || !state) return;
  if (buySupply(state, button.dataset.supply)) { audio.effect('upgrade'); renderUpgrades(); autosave(); const next = document.querySelector(`[data-supply="${button.dataset.supply}"]`); if (!next.disabled) next.focus(); else $('next-button').focus(); }
});
$('upgrade-list').addEventListener('click', event => {
  const button = event.target.closest('[data-upgrade]'); if (!button || !state) return;
  if (buyUpgrade(state, button.dataset.upgrade)) { audio.effect('upgrade'); renderUpgrades(); autosave(); const next = document.querySelector(`[data-upgrade="${button.dataset.upgrade}"]`); if (!next.disabled) next.focus(); else $('next-button').focus(); }
});

function toggleSound() {
  audio.mute(!audio.muted); audio.start(); syncSettings();
  try { localStorage.setItem('tyran-muted', String(audio.muted)); } catch { /* optional */ }
}
function syncSettings() {
  $('sound-toggle').setAttribute('aria-pressed', String(!audio.muted)); $('sound-toggle').setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
  $('sound-toggle').dataset.muted = String(audio.muted); $('sound-toggle').title = audio.muted ? 'Sound off · V' : 'Sound on · V';
  if ($('sound-label')) $('sound-label').textContent = audio.muted ? 'Sound off' : 'Sound on';
  const qualityText = quality === 'high' ? 'Effects high' : 'Effects low';
  if ($('quality-label')) $('quality-label').textContent = qualityText; else $('quality-toggle').textContent = qualityText;
  $('quality-toggle').setAttribute('aria-label', `Effects ${quality}. Click to switch.`); $('quality-toggle').setAttribute('aria-pressed', String(quality === 'high'));
  if ($('pause-sound-toggle')) { $('pause-sound-toggle').textContent = audio.muted ? 'Sound off · V' : 'Sound on · V'; $('pause-sound-toggle').setAttribute('aria-pressed', String(!audio.muted)); }
  if ($('pause-quality-toggle')) { $('pause-quality-toggle').textContent = qualityText; $('pause-quality-toggle').setAttribute('aria-pressed', String(quality === 'high')); }
  fx.quality = quality;
}
on('sound-toggle', toggleSound);
on('pause-sound-toggle', toggleSound);
function toggleQuality() { quality = quality === 'high' ? 'low' : 'high'; resolutionScale = 1; lastAdapt = performance.now() / 1000; syncSettings(); resize(); try { localStorage.setItem('tyran-quality', quality); } catch { /* optional */ } }
on('quality-toggle', toggleQuality); on('pause-quality-toggle', toggleQuality);
on('fullscreen-toggle', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { $('fullscreen-toggle').title = 'Fullscreen is unavailable in this browser'; } });
function closeHelp() { $('help-screen').hidden = true; if (helpPaused && scene === 'pause') pause(); else helpFocus?.focus({ preventScroll: true }); helpPaused = false; }
on('help-button', () => { helpFocus = document.activeElement; helpPaused = scene === 'playing'; if (helpPaused) pause(); $('help-screen').hidden = false; $('help-close').focus(); }); on('help-close', closeHelp);

const stick = $('touch-stick');
if (stick) {
  stick.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || scene !== 'playing' || touch.pointer != null) return; touch.pointer = e.pointerId; touch.originX = e.clientX; touch.originY = e.clientY; stick.setPointerCapture(e.pointerId); consumeInput(e); });
  stick.addEventListener('pointermove', e => { if (scene !== 'playing' || e.pointerId !== touch.pointer) return; consumeInput(e); touch.x = clamp((e.clientX - touch.originX) / 42, -1, 1); touch.y = clamp((e.clientY - touch.originY) / 42, -1, 1); stick.style.setProperty('--stick-x', `${touch.x * 24}px`); stick.style.setProperty('--stick-y', `${touch.y * 24}px`); });
  const release = e => { if (e.pointerId !== touch.pointer) return; consumeInput(e); touch.pointer = null; touch.x = touch.y = 0; stick.style.setProperty('--stick-x', '0px'); stick.style.setProperty('--stick-y', '0px'); };
  stick.addEventListener('pointerup', release); stick.addEventListener('pointercancel', release); stick.addEventListener('lostpointercapture', release);
}
for (const [id, channel] of [['touch-fire', 'fire'], ['touch-secondary', 'secondary'], ['touch-bomb', 'bomb']]) {
  const button = $(id);
  if (!button) continue;
  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || scene !== 'playing') return;
    touch[channel] = true; button.setPointerCapture(event.pointerId); audio.start(); consumeInput(event);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, event => {
    if (event.pointerType === 'mouse') return;
    consumeInput(event); touch[channel] = false;
  });
}

$('world-list').innerHTML = WORLDS.map((w, i) => `<button class="world-card ${i === 0 ? 'active' : ''}" data-world="${i}" aria-pressed="${i === 0}" aria-label="Preview sector ${i + 1}: ${w.name}" style="--world-color:${w.color || w.accent}"><span class="world-number">${String(i + 1).padStart(2, '0')}</span><span class="world-name">${w.name}</span><span class="world-type">${w.subtitle || w.id}</span><span class="world-orbit" aria-hidden="true"></span></button>`).join('');
  $('world-list').addEventListener('click', event => { const button = event.target.closest('button[data-world]'); if (button) { document.body.dataset.preview = 'true'; selectWorld(Number(button.dataset.world)); } });
canvas.tabIndex = -1;
document.querySelectorAll('.modal-screen').forEach(el => { el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); });
await warmShopArt();
syncSettings(); refreshDifficultyChoice(); refreshContinue(); selectWorld(0); setScreen('menu'); resize();
setText($('startup-status'), 'Preparing terrain…');
await world.prepareReady(W, H);
// Readable state and deterministic stepping for browser QA and tuning.
window.tyran = {
  get state() { return state; }, get scene() { return scene; }, get world() { return world; }, get fx() { return fx; }, get feedback() { return feedback; }, worlds: WORLDS, enemyTypes: ENEMY_TYPES, weapons: WEAPONS, bulletSpectrum: BULLET_SPECTRUM, parallaxLayers: PARALLAX_LAYERS, shipPalettes: SHIP_PALETTES,
  get performance() { return { ...perf, interpolation: renderAlpha, fixedStep: STEP }; },
  launch, selectWorld, selectWeapon, pause, spriteStatus, buyPrimary, buySupply,
  step(seconds, controls = []) { for (let i = 0; i < Math.ceil(seconds * 60); i++) { if (state && scene === 'playing') { previousScroll = state.scroll; update(state, STEP, controls, environmentHit); processEvents(); } } accumulator = 0; renderAlpha = 1; renderDirty = true; refreshHUD(); requestFrame(); },
};
document.body.dataset.ready = 'true';
$('menu-screen').inert = false;
$('startup-status').hidden = true;
requestFrame();
