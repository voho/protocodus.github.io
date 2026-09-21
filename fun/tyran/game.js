import { WORLDS, PARALLAX_LAYERS, WorldRenderer } from './worlds.js';
import { ENEMY_TYPES, SHIP_PALETTES, drawShip, warmShipSprites } from './ships.js';
import { createCampaign, beginLevel, update, buyUpgrade, upgradeCost, UPGRADES, WEAPONS, BULLET_SPECTRUM, MAX_UPGRADE, clamp, selectWeapon, shipStats, weaponStats, SECONDARY_ENERGY_COST, SECONDARY_RESTART_ENERGY, bossWeakPointPosition, comboLabel, applyGroundReward } from './sim.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { readCampaign, writeCampaign } from './save-game.js';
import { spritesReady, spriteStatus, spriteCell } from './sprite-assets.js';
import { drawProjectiles, warmProjectileTextures } from './projectile-sprites.js';

// Decode the atlas library before warming render caches or accepting flight input.
await spritesReady;

const elements = new Map();
const $ = id => { if (!elements.has(id)) { const el = document.getElementById(id); if (el) elements.set(id, el); } return elements.get(id); };
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const setFill = (el, fraction) => { const transform = `scaleX(${Number(clamp(fraction, 0, 1).toFixed(3))})`; if (el.style.transform !== transform) el.style.transform = transform; };
const setHidden = (el, hidden) => { if (el.hidden !== hidden) el.hidden = hidden; };
const setAttribute = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
const canvas = $('game-canvas'), ctx = canvas.getContext('2d', { alpha: false });
const world = new WorldRenderer(), fx = new Effects(), audio = new AudioEngine();
const keys = new Set(), numberFormat = new Intl.NumberFormat('en-US'), number = n => numberFormat.format(Math.floor(n || 0));
const screens = ['menu-screen', 'pause-screen', 'hangar-screen', 'end-screen'];
let campaign = campaignSummary(readCampaign()), campaignError = null, activeCampaign = false, lastAutosaveTime = 0;
let state = null, selected = 0, scene = 'menu', unlocked = campaign.run?.unlocked || 0;
let W = 1200, H = 900, dpr = 1, previewScroll = 0, clock = 0, lastTime = 0, hudClock = 0;
let announcementUntil = 0, quality = 'high', helpPaused = false, helpFocus = null;
let keyboardLockEpoch = 0;
const STEP = 1 / 60;
let accumulator = 0, previousScroll = 0, renderAlpha = 1, renderDirty = true, frameHandle = 0, idleHandle = 0;
let resolutionScale = 1, frameAverage = 16.7, fastestFrame = 100, lastAdapt = 0, vignette = null;
const perf = { fps: 60, frameMs: 16.7, renderMs: 0, updateMs: 0, renderScale: 1, frames: 0, steps: 0 };
const environmentHit = (...args) => world.hit(...args);
const groundTargets = s => {
  let focus = 0, pilots = 0;
  for (const player of s.players) if (player.alive) { focus += player.x; pilots++; }
  return world.getGroundTargets(s.width, s.height, s.scroll, pilots ? focus / pilots : s.width * .5);
};
const lerp = (before, after) => (before ?? after) + (after - (before ?? after)) * renderAlpha;
const controls = [{ x: 0, y: 0, fire: false, secondary: false }];
const touch = { x: 0, y: 0, fire: false, secondary: false, pointer: null, originX: 0, originY: 0 };

try {
  audio.mute(localStorage.getItem('tyran-muted') === 'true');
  quality = localStorage.getItem('tyran-quality') === 'low' ? 'low' : 'high';
} catch { /* Local saves are optional in private/restricted browsing. */ }

// Resume reads the authoritative local save on demand. Keep only menu metadata
// here, rather than a second entire flight and destruction ledger after each save.
function campaignSummary(result) {
  if (!result.run) return result;
  const { scene, unlocked, state: { level, credits, score } } = result.run;
  return { ok: result.ok, error: result.error, run: { scene, unlocked, state: { level, credits, score } } };
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
  for (const pilot of state.players) { pilot.x = clamp(pilot.x, 30, W - 30); pilot.y = clamp(pilot.y, 105, H - 42); pilot.px = pilot.x; pilot.py = pilot.y; }
  for (const formation of state.formations) {
    formation.x *= sx; formation.baseX *= sx; formation.y *= sy;
    for (const offset of formation.offsets) { offset.x *= sx; offset.y *= sy; }
  }
  for (const turret of state.turrets || []) { turret.x *= sx; turret.y *= sy; turret.radius *= sx; }
  state.width = W; state.height = H; selected = state.level;
  world.setWorld(state.level, run.seed); world.restoreDamage(run.damage, run.destroyed, run.sceneryVersion);
  world.setTurretActivity(state.turrets || []);
  warmFleet(state.level); fx.reset(); keys.clear(); clock = state.time;
  $('announcement').hidden = true; $('boss-hud').hidden = true;
  if (run.scene === 'hangar') showHangar(0, true);
  else if (run.scene === 'end') showEnd(true, true);
  else { setScreen('pause'); $('resume-button').focus({ preventScroll: true }); }
  refreshHUD();
  if (run.migrated) autosave();
  else refreshContinue();
}

function setScreen(next) {
  scene = next;
  for (const id of screens) if ($(id)) $(id).hidden = id !== `${next}-screen`;
  $('hud').hidden = next === 'menu';
  document.body.dataset.scene = next;
  if ($('touch-controls')) $('touch-controls').hidden = next !== 'playing';
  if (next !== 'playing') {
    keys.clear(); touch.x = touch.y = 0; touch.fire = touch.secondary = false;
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

function sizeSurface(rect) {
  const pixelBudget = quality === 'high' ? 4_000_000 : 2_200_000;
  dpr = Math.min(devicePixelRatio || 1, quality === 'high' ? 1.7 : 1, Math.sqrt(pixelBudget / (rect.width * rect.height))) * resolutionScale;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  perf.renderScale = dpr;
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  vignette = ctx.createRadialGradient(W * .5, H * .5, H * .25, W * .5, H * .5, Math.max(W, H) * .75);
  vignette.addColorStop(0, '#02080d00'); vignette.addColorStop(1, '#02080d9c');
  renderDirty = true;
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const oldW = W, oldH = H;
  H = 900; W = Math.round(clamp(H * rect.width / Math.max(1, rect.height), 430, 1900));
  sizeSurface(rect);
  if (state) {
    state.width = W; state.height = H;
    for (const p of state.players) { p.x = clamp(p.x / oldW * W, 30, W - 30); p.y = p.y / oldH * H; p.px = p.x; p.py = p.y; }
    for (const e of state.enemies) { e.x = e.x / oldW * W; e.originX = e.originX / oldW * W; e.px = e.x; e.py = e.y; }
    for (const formation of state.formations) {
      formation.x *= W / oldW; formation.baseX *= W / oldW; formation.y *= H / oldH;
      for (const offset of formation.offsets) { offset.x *= W / oldW; offset.y *= H / oldH; }
    }
    for (const b of state.bullets) { b.x *= W / oldW; b.px = b.x; b.py = b.y; }
    for (const p of state.pickups) p.x *= W / oldW;
    for (const turret of state.turrets || []) { turret.x *= W / oldW; turret.y *= H / oldH; turret.radius *= W / oldW; }
    for (const list of [fx.particles, fx.rings, fx.lights, fx.texts, fx.wrecks, fx.flares]) for (const effect of list) effect.x *= W / oldW;
  }
  if (scene === 'menu') world.prepare(W, H);
  requestFrame();
}

function warmFleet(index) {
  warmShipSprites(SHIP_PALETTES[index], index);
  warmShipSprites('#a4ffee', index, true);
  warmProjectileTextures(WEAPONS, BULLET_SPECTRUM);
  for (const kind of ['repair', 'credit', 'rapid', 'invulnerable']) pickupTexture(kind);
  pilotBarrierTexture();
}

function announce(kicker, title, description = '', seconds = 3) {
  $('announcement-kicker').textContent = kicker;
  $('announcement-title').textContent = title;
  $('announcement-description').textContent = description;
  $('announcement').hidden = false;
  announcementUntil = clock + seconds;
}

function launch(level = 0, checkpoint = null, persist = true) {
  audio.start();
  activeCampaign = persist; lastAutosaveTime = 0;
  level = clamp(Math.floor(Number(level) || 0), 0, WORLDS.length - 1);
  selected = level;
  state = createCampaign(level, checkpoint);
  state.startLevel = checkpoint?.startLevel ?? level;
  state.width = W; state.height = H; beginLevel(state, level);
  world.setWorld(level); warmFleet(level); fx.reset(); keys.clear(); previousScroll = 0; $('boss-hud').hidden = true;
  setScreen('playing');
  announce(`Sector ${String(level + 1).padStart(2, '0')} / 10`, WORLDS[level].name, WORLDS[level].subtitle || 'Clear the skies. Bring everyone home.', 3.2);
  autosave(); refreshContinue();
  canvas.focus({ preventScroll: true });
  refreshHUD();
}

function returnToMenu() {
  autosave();
  state = null; activeCampaign = false; fx.reset(); selectWorld(selected); setScreen('menu');
  $('announcement').hidden = true; $('boss-hud').hidden = true; refreshContinue();
  $(campaign.run ? 'continue-button' : 'launch-button').focus({ preventScroll: true });
}

function pause() {
  if (scene === 'playing') { setScreen('pause'); autosave(); $('resume-button').focus({ preventScroll: true }); }
  else if (scene === 'pause') { audio.start(); setScreen('playing'); canvas.focus({ preventScroll: true }); }
}

function refreshHUD() {
  if (!state) return;
  const bonuses = String(state.players.some(p => p.alive && (p.rapidFireTime > 0 || p.invulnerableTime > 0)));
  if (document.body.dataset.bonuses !== bonuses) document.body.dataset.bonuses = bonuses;
  setText($('level-name'), WORLDS[state.level].name);
  setText($('level-number'), `${String(state.level + 1).padStart(2, '0')} / 10`);
  setText($('score-value'), number(state.score)); setText($('credits-value'), number(state.credits));
  const profile = weaponStats(state, 'pulse');
  const stats = shipStats(state.upgrades);
  setText($('weapon-value'), 'Pulse + plasma'); setText($('weapon-level'), `MK ${String(profile.level + 1).padStart(2, '0')}`);
  const activeCombo = state.combo >= 2 && state.comboTime > 0;
  setText($('combo-value'), activeCombo ? `${state.combo} · ${comboLabel(state.combo)}` : 'READY');
  setFill($('combo-fill'), activeCombo ? state.comboTime / 5.2 : 0);
  $('combo-instrument').classList.toggle('active', activeCombo);
  setFill($('progress-fill'), state.time / state.duration);
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
  const boss = state.enemies.find(e => e.boss && !e.dead);
  setHidden($('boss-hud'), !boss);
  if (boss) {
    setText($('boss-name'), WORLDS[state.level].bossName || 'Sector guardian'); setFill($('boss-fill'), boss.hp / boss.maxHp);
    setText($('boss-status'), boss.vulnerable ? `Core exposed · ${boss.windowClock.toFixed(1)}s` : `Armor sealed · ${boss.windowClock.toFixed(1)}s`);
    $('boss-hud').classList.toggle('exposed', !!boss.vulnerable);
  }
}

function showHangar(bonus, loading = false) {
  if (activeCampaign) unlocked = Math.max(unlocked, state.level + 1);
  setScreen('hangar'); $('announcement').hidden = true;
  $('hangar-title').textContent = 'Refit your ship.';
  $('hangar-subtitle').textContent = `${WORLDS[state.level].name} cleared · ${state.kills} ship${state.kills === 1 ? '' : 's'} down · ${state.destroyed} ground targets destroyed.${bonus ? ` ${number(bonus)} credits awarded.` : ''} Spend your salvage before the next launch; hull, shields and fire energy will be restored.`;
  $('next-button').textContent = `Launch sector ${String(state.level + 2).padStart(2, '0')} — ${WORLDS[state.level + 1].name}  ↗`;
  $('campaign-route').innerHTML = WORLDS.map((world, index) => {
    const complete = index >= (state.startLevel || 0) && index <= state.level, current = index === state.level + 1;
    return `<li class="${complete ? 'complete' : current ? 'current' : ''}" ${current ? 'aria-current="step"' : ''}><span>${String(index + 1).padStart(2, '0')}${complete ? ' ✓' : ''}</span><strong>${world.name}</strong></li>`;
  }).join('');
  renderUpgrades(); $('next-button').focus({ preventScroll: true });
  if (!loading) autosave();
}

function renderUpgrades() {
  $('hangar-credits').textContent = number(state.credits);
  const stats = shipStats(state.upgrades), weapon = weaponStats(state, 'pulse');
  $('hangar-loadout').innerHTML = `<div><dt>Hull capacity</dt><dd>${stats.hull}</dd></div><div><dt>Shield capacity</dt><dd>${stats.shield}</dd></div><div><dt>Fire energy</dt><dd>${stats.energy}<small>${stats.energyRecharge}/s · ${stats.energyDelay.toFixed(1)}s delay</small></dd></div><div><dt>Armament</dt><dd>Mk ${weapon.level + 1}<small>Pulse + plasma</small></dd></div>`;
  $('upgrade-list').innerHTML = UPGRADES.map(u => {
    const level = state.upgrades[u.id], maxed = level >= MAX_UPGRADE, cost = upgradeCost(state, u.id);
    const next = { ...state, upgrades: { ...state.upgrades, [u.id]: Math.min(MAX_UPGRADE, level + 1) } }, upgraded = shipStats(next.upgrades), nextWeapon = weaponStats(next, weapon.id);
    const preview = u.id === 'weapon' ? `${weapon.damage.toFixed(1)} → ${nextWeapon.damage.toFixed(1)} power · ${(1 / nextWeapon.interval).toFixed(1)} shots/s`
      : u.id === 'recharge' ? `${stats.recharge} → ${upgraded.recharge} shield/s · ${stats.energyRecharge} → ${upgraded.energyRecharge} energy/s`
      : `${stats[u.id]} → ${upgraded[u.id]} ${u.id}`;
    return `<button class="upgrade-card" data-upgrade="${u.id}" ${maxed || state.credits < cost ? 'disabled' : ''}><span class="upgrade-icon" aria-hidden="true">${u.icon}</span><span class="upgrade-level">Mk ${String(level + 1).padStart(2, '0')} / 07</span><span class="upgrade-name">${u.name}</span><span class="upgrade-description">${u.subtitle}</span><span class="upgrade-preview">${maxed ? 'Maximum performance reached' : preview}</span><span class="upgrade-pips" aria-hidden="true">${Array.from({ length: 6 }, (_, i) => `<i class="${i < level ? 'filled' : ''}"></i>`).join('')}</span><span class="upgrade-cost">${maxed ? 'Fully upgraded' : `${number(cost)} credits <span aria-hidden="true">+</span>`}</span></button>`;
  }).join('');
  renderWeapons();
}

function renderWeapons() {
  const fastestInterval = weaponStats(state, 'pulse').interval;
  $('weapon-list').innerHTML = WEAPONS.map(weapon => {
    const stats = weaponStats(state, weapon.id), secondary = weapon.id === 'plasma';
    const power = Math.round(Math.min(100, stats.damage * stats.count * 1.18));
    const speed = Math.round(100 * fastestInterval / stats.interval);
    const range = Math.round(Math.min(100, stats.speed / 12));
    return `<article class="weapon-card" data-weapon="${weapon.id}" style="--weapon-color:${weapon.color}"><span class="weapon-icon" aria-hidden="true">${secondary ? '◉' : 'Ⅱ'}</span><span class="weapon-swatch"></span><span class="weapon-copy"><strong>${weapon.name}</strong><small>${secondary ? 'Secondary · Q' : 'Primary · Space'}</small></span><span class="weapon-description">${weapon.description} ${secondary ? `${SECONDARY_ENERGY_COST} energy per shot; resumes at ${SECONDARY_RESTART_ENERGY} after depletion.` : 'Unlimited fire; no energy cost.'}</span><span class="weapon-bars" aria-label="Power ${power}, fire rate ${speed}, reach ${range}"><i style="--bar:${power}%"></i><i style="--bar:${speed}%"></i><i style="--bar:${range}%"></i></span><span class="weapon-readout"><b>${stats.damage.toFixed(1)} DMG</b><b>${(1 / stats.interval).toFixed(1)} / SEC</b></span></article>`;
  }).join('');
}

function showEnd(won, loading = false) {
  setScreen('end'); $('announcement').hidden = true;
  $('end-title').textContent = won ? 'The skies are yours.' : 'Signal lost.';
  $('end-description').textContent = won ? 'The citadel has fallen. Your campaign is complete. Start a fresh flight or return to flight command.' : `Your flight ended over ${WORLDS[state.level].name}. Retry with your current equipment or return to the main menu.${activeCampaign && campaign.run ? ' Your last autosave is ready to resume.' : ''}`;
  $('end-score').textContent = number(state.score);
  $('retry-button').textContent = won ? 'Fly a new campaign ↗' : 'Retry sector ↗';
  if (won && !loading && activeCampaign) { unlocked = 9; autosave(); }
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
  saveStatus(status);
  if (state && !activeCampaign) {
    for (const id of ['pause-save-status', 'hangar-save-status']) setText($(id), 'Practice flight · Your campaign stays saved.');
  }
}

function saveDescription(run) {
  return run.scene === 'end' ? 'Campaign complete' : `Sector ${String(run.state.level + 1).padStart(2, '0')} · ${run.scene === 'hangar' ? 'Shop' : 'Flight'}`;
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
  return controls;
}

function processEvents() {
  const groundOffset = (world.parallaxX || 0) * W / 1200;
  const events = state.events.length ? state.events.splice(0) : state.events;
  for (const e of events) {
    fx.emit(e, state.scroll * W / 1200, groundOffset); audio.effect(e.type, e.size, e.weapon || e.label);
    if (e.type === 'explosion' && !e.ground) {
      const blast = e.blast || 1;
      for (const prop of world.hit(e.x, e.y, Math.min(250, e.size * 1.5 * blast), e.size * 2 * blast, state.scroll)) {
        applyGroundReward(state, prop, blast);
      }
    }
    if (e.type === 'boss') announce('Warning · heavy signature', WORLDS[state.level].bossName, 'Break through its armor. Watch for changing attack patterns.', 3);
    if (e.type === 'phase') announce('Reactor surge', 'Guardian enraged', 'New attack pattern detected.', 1.6);
    if (e.type === 'boss-open' && e.openCount === 1) announce('Window open', 'Core exposed', 'Aim for the glowing weak points before the armor seals.', 1.5);
    if (e.type === 'formation') announce('Tactical formation', e.label, `${e.count} contacts moving as one.`, 1.15);
    if (e.type === 'weapon') { refreshHUD(); renderWeapons(); }
    if (e.type === 'pickup' && e.bonus) refreshHUD();
    if (e.type === 'hangar') showHangar(e.bonus);
    if (e.type === 'defeat') showEnd(false);
    if (e.type === 'victory') showEnd(true);
    // Collateral destruction can add ground effects even on the final tick.
    if (state.events.length) events.push(...state.events.splice(0));
  }
  world.setTurretActivity(state.turrets || []);
  // Save at a bounded cadence, after combat and reward events have settled.
  if (scene === 'playing' && activeCampaign && state.time - lastAutosaveTime >= 5) autosave();
}

const pickupTextures = new Map();
function pickupTexture(kind) {
  const repair = kind === 'repair', timed = kind === 'rapid' || kind === 'invulnerable';
  const key = timed ? kind : repair ? 'repair' : 'credit';
  if (pickupTextures.has(key)) return pickupTextures.get(key);
  const out = document.createElement('canvas'); out.width = out.height = 96;
  const paint = out.getContext('2d'), color = key === 'rapid' ? '#ffe2a0' : repair || key === 'invulnerable' ? '#aaffd0' : '#ffdc90';
  // The same restrained green halo marks every collectible as beneficial;
  // the repair capsule and gold credit chips keep their distinct body colors.
  const glow = paint.createRadialGradient(48, 48, 10, 48, 48, 45);
  glow.addColorStop(0, '#6bf3a04d'); glow.addColorStop(.4, '#62e99526'); glow.addColorStop(1, '#62e99500');
  paint.fillStyle = glow; paint.fillRect(0, 0, 96, 96);
  const source = spriteCell('pickups', repair || key === 'invulnerable' ? 0 : 1);
  if (source) {
    const scale = 58 / Math.max(source.width, source.height), width = source.width * scale, height = source.height * scale;
    paint.shadowColor = '#02080dcc'; paint.shadowBlur = 5; paint.shadowOffsetY = 4;
    paint.drawImage(source, 48 - width / 2, 48 - height / 2, width, height);
  } else {
    paint.fillStyle = color; paint.font = 'bold 42px sans-serif'; paint.textAlign = 'center'; paint.textBaseline = 'middle';
    paint.fillText(repair ? '+' : '•', 48, 48);
  }
  if (timed) {
    // Reuse the detailed equipment body, with distinct high-contrast emblems.
    paint.shadowBlur = 0; paint.shadowOffsetY = 0;
    paint.fillStyle = '#09201eee'; paint.strokeStyle = color; paint.lineWidth = 1.8;
    paint.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 - Math.PI / 2;
      const x = 48 + Math.cos(a) * 23, y = 46 + Math.sin(a) * 23;
      i ? paint.lineTo(x, y) : paint.moveTo(x, y);
    }
    paint.closePath(); paint.fill(); paint.stroke();
    paint.fillStyle = color; paint.lineWidth = 2.8; paint.lineJoin = 'round';
    paint.beginPath();
    if (key === 'rapid') {
      paint.moveTo(50, 28); paint.lineTo(37, 48); paint.lineTo(46, 48);
      paint.lineTo(43, 63); paint.lineTo(59, 41); paint.lineTo(49, 41);
      paint.closePath(); paint.fill();
    } else {
      paint.moveTo(48, 31); paint.lineTo(60, 36); paint.lineTo(58, 49);
      paint.quadraticCurveTo(55, 56, 48, 61); paint.quadraticCurveTo(41, 56, 38, 49);
      paint.lineTo(36, 36); paint.closePath(); paint.stroke();
      paint.fillRect(46, 40, 4, 11); paint.fillRect(42, 44, 12, 3);
    }
    paint.font = 'bold 10px "Oxanium", sans-serif'; paint.textAlign = 'center'; paint.fillText('10s', 48, 81);
  }
  pickupTextures.set(key, out); return out;
}

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
    ctx.strokeStyle = '#ffe2a0'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(x + side * 26, y + 14);
      ctx.lineTo(x + side * 32, y + 6); ctx.lineTo(x + side * 38, y + 14); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + side * 26, y + 23);
      ctx.lineTo(x + side * 32, y + 15); ctx.lineTo(x + side * 38, y + 23); ctx.stroke();
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
  const scroll = state ? lerp(previousScroll, state.scroll) : previewScroll, index = state ? state.level : selected;
  ctx.save();
  const impactMotion = scene === 'playing' || scene === 'end';
  const shake = fx.reduced || !impactMotion ? 0 : fx.shake;
  if (shake > .3) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
  let focusX = 0, focusPilots = 0;
  for (const pilot of state?.players || []) if (pilot.alive) { focusX += lerp(pilot.px, pilot.x); focusPilots++; }
  focusX = focusPilots ? focusX / focusPilots : W * .66;
  world.draw(ctx, W, H, scroll, clock, quality, focusX, !fx.reduced);
  fx.drawGround(ctx, scroll * W / 1200, H, (world.parallaxX || 0) * W / 1200);
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
    for (const e of state.enemies) {
      const x = lerp(e.px, e.x), y = lerp(e.py, e.y);
      if (y < -e.radius * 2 || y > H + e.radius * 2) continue;
      const palette = SHIP_PALETTES[index];
      drawShip(ctx, x, y, e.radius * (e.type < 2 ? 1.35 : 1), e.type, palette?.primary || WORLDS[index].enemyColor || '#b07355', clock, { hit: e.hurt / .07 * .3, phase: e.phase, world: index, quality, thrust: e.thrust, palette, motion: !fx.reduced });
      drawBossWeakPoints(e, clock);
      if (!e.boss && e.hp < e.maxHp && e.radius >= 24) {
        ctx.fillStyle = '#09171aca'; ctx.fillRect(x - e.radius, y - e.radius * 1.6 - 8, e.radius * 2, 3);
        ctx.fillStyle = '#fb9f7c'; ctx.fillRect(x - e.radius, y - e.radius * 1.6 - 8, e.radius * 2 * Math.max(0, e.hp / e.maxHp), 3);
      }
    }
    for (const pickup of state.pickups) {
      const timed = pickup.kind === 'rapid' || pickup.kind === 'invulnerable';
      const size = timed ? 76 + (fx.reduced ? 0 : Math.sin(clock * 3 + pickup.age) * 2) : 64;
      ctx.drawImage(pickupTexture(pickup.kind), pickup.x - size / 2, pickup.y - size / 2, size, size);
    }
    drawProjectiles(ctx, state.bullets, renderAlpha, W, H);
    for (const p of state.players) if (p.alive) {
      const color = '#a4ffee', x = lerp(p.px, p.x), y = lerp(p.py, p.y);
      drawShip(ctx, x, y, 30, 'player', color, clock, { hit: p.hurt > .2 ? 1 : 0, player: p.id, world: index, thrust: p.thrust, quality, motion: !fx.reduced });
      if (p.shield > 1) {
        ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = .08 + p.shield / p.maxShield * .13 + (p.hurt > 0 ? .45 : 0);
        ctx.beginPath(); ctx.ellipse(0, 0, 37, 46, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha *= .36; ctx.fillStyle = color; ctx.fill(); ctx.restore();
      }
      drawPilotBonuses(p, x, y);
    }
    if (state.combo >= 2 && state.comboTime > 0) {
      ctx.textAlign = 'right'; ctx.font = 'bold 17px "Space Grotesk", sans-serif'; ctx.fillStyle = state.combo >= 5 ? '#ffe36d' : '#d8fce7';
      ctx.fillText(`${state.combo}  ${comboLabel(state.combo)}`, W - 30, H - 32);
      ctx.fillStyle = '#d8fce766'; ctx.fillRect(W - 180, H - 20, 150, 2); ctx.fillStyle = '#ffe18c'; ctx.fillRect(W - 180, H - 20, 150 * clamp(state.comboTime / 5.2, 0, 1), 2);
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
  const fading = scene === 'end' && (fx.particles.length || fx.rings.length || fx.delayed.length || fx.texts.length || fx.lights.length || fx.flares.length || fx.damagePulse > .02 || fx.flash > .01 || fx.shake > .3);
  const active = scene === 'playing' || preview || fading;
  if (active) clock += dt;
  if (scene === 'playing' && state) {
    const started = performance.now();
    accumulator = Math.min(.1, accumulator + dt);
    while (accumulator + 1e-9 >= STEP && scene === 'playing') {
      previousScroll = state.scroll;
      update(state, STEP, input(), environmentHit, groundTargets);
      accumulator -= STEP; perf.steps++;
      processEvents();
    }
    renderAlpha = scene === 'playing' ? clamp(accumulator / STEP, 0, 1) : 1;
    perf.updateMs += (performance.now() - started - perf.updateMs) * .05;
    fx.update(dt);
    if (elapsed > .006) {
      fastestFrame = Math.min(fastestFrame, elapsed * 1000);
      // A very slow frame still counts toward load; only simulation catch-up is capped.
      frameAverage += (Math.min(elapsed, .25) * 1000 - frameAverage) * .025;
      perf.frameMs = frameAverage; perf.fps = 1000 / frameAverage;
      const wallClock = time / 1000;
      // Reduce only backing resolution under sustained load; physics and game speed stay fixed.
      if (wallClock - lastAdapt > 4 && frameAverage > Math.max(25, fastestFrame * 1.55) && resolutionScale > .7) {
        resolutionScale = Math.max(.7, resolutionScale - .1); sizeSurface(canvas.getBoundingClientRect()); lastAdapt = wallClock;
      } else if (wallClock - lastAdapt > 12 && frameAverage < Math.max(18, fastestFrame * 1.15) && perf.renderMs < 7 && resolutionScale < 1) {
        resolutionScale = Math.min(1, resolutionScale + .05); sizeSurface(canvas.getBoundingClientRect()); lastAdapt = wallClock;
      }
    }
  } else if (preview) previewScroll += dt * 45;
  else if (fading) fx.update(dt);
  audio.update(scene === 'playing', state?.level || 0);
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

const controlledKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ']);
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
for (const type of ['contextmenu', 'dragstart']) canvas.addEventListener(type, consumeInput);
canvas.addEventListener('wheel', event => { if (scene === 'playing') consumeInput(event); }, { passive: false });
// Clicking the arena only restores keyboard focus; flight uses keys or touch.
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || scene !== 'playing') return;
  canvas.focus({ preventScroll: true }); consumeInput(event);
});
function on(id, fn) { $(id)?.addEventListener('click', fn); }
on('launch-button', () => launch(0));
on('sector-flight-button', () => launch(selected, null, false));
on('continue-button', resumeCampaign);
on('hangar-menu-button', returnToMenu);
on('pause-button', pause); on('resume-button', pause); on('menu-button', returnToMenu); on('end-menu-button', returnToMenu);
on('restart-button', () => launch(state.level, state, activeCampaign));
on('retry-button', () => state.status === 'victory' ? launch(0) : launch(state.level, state, activeCampaign));
on('next-button', () => {
  if (state?.status !== 'hangar') return;
  beginLevel(state, state.level + 1); world.setWorld(state.level); warmFleet(state.level); previousScroll = 0; fx.reset(); setScreen('playing'); audio.start(); $('boss-hud').hidden = true;
  announce(`Sector ${String(state.level + 1).padStart(2, '0')} / 10`, WORLDS[state.level].name, WORLDS[state.level].subtitle, 3); refreshHUD(); canvas.focus({ preventScroll: true });
  autosave();
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
for (const [id, channel] of [['touch-fire', 'fire'], ['touch-secondary', 'secondary']]) {
  const button = $(id);
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
syncSettings(); refreshContinue(); selectWorld(0); setScreen('menu'); resize();
// Readable state and deterministic stepping for browser QA and tuning.
window.tyran = {
  get state() { return state; }, get scene() { return scene; }, get world() { return world; }, worlds: WORLDS, enemyTypes: ENEMY_TYPES, weapons: WEAPONS, bulletSpectrum: BULLET_SPECTRUM, parallaxLayers: PARALLAX_LAYERS, shipPalettes: SHIP_PALETTES,
  get performance() { return { ...perf, interpolation: renderAlpha, fixedStep: STEP }; },
  launch, selectWorld, selectWeapon, pause, spriteStatus,
  step(seconds, controls = []) { for (let i = 0; i < Math.ceil(seconds * 60); i++) { if (state && scene === 'playing') { previousScroll = state.scroll; update(state, STEP, controls, environmentHit, groundTargets); processEvents(); } } accumulator = 0; renderAlpha = 1; renderDirty = true; refreshHUD(); requestFrame(); },
};
document.body.dataset.ready = 'true';
$('menu-screen').inert = false;
$('startup-status').hidden = true;
requestFrame();
