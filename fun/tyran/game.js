import { WORLDS, PARALLAX_LAYERS, WorldRenderer } from './worlds.js';
import { ENEMY_TYPES, SHIP_PALETTES, drawShip, warmShipSprites } from './ships.js';
import { createCampaign, beginLevel, update, buyUpgrade, upgradeCost, UPGRADES, WEAPONS, BULLET_SPECTRUM, MAX_UPGRADE, PLAYER_SPEED, clamp, selectWeapon, shipStats, weaponStats, bossWeakPointPosition, comboLabel, applyStructureBlast } from './sim.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { readSave, writeSave } from './save-game.js';
import { spritesReady, spriteStatus, spriteCell } from './sprite-assets.js';
import { projectileTexture, projectileLayout, warmProjectileTextures } from './projectile-sprites.js';

// Decode the atlas library before warming render caches or accepting flight input.
await spritesReady;

const elements = new Map();
const $ = id => { if (!elements.has(id)) { const el = document.getElementById(id); if (el) elements.set(id, el); } return elements.get(id); };
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const setWidth = (el, fraction) => { const width = `${(clamp(fraction, 0, 1) * 100).toFixed(1)}%`; if (el.style.width !== width) el.style.width = width; };
const canvas = $('game-canvas'), ctx = canvas.getContext('2d', { alpha: false });
const world = new WorldRenderer(), fx = new Effects(), audio = new AudioEngine();
const keys = new Set(), numberFormat = new Intl.NumberFormat('en-US'), number = n => numberFormat.format(Math.floor(n || 0));
const screens = ['menu-screen', 'pause-screen', 'hangar-screen', 'end-screen'];
const saves = { auto: readSave('auto'), manual: readSave('manual') };
let state = null, mode = 1, selected = 0, scene = 'menu', unlocked = Math.max(0, saves.auto.run?.unlocked || 0, saves.manual.run?.unlocked || 0);
let W = 1200, H = 900, dpr = 1, previewScroll = 0, clock = 0, lastTime = 0, hudClock = 0;
let announcementUntil = 0, quality = 'high', helpPaused = false, helpFocus = null;
const STEP = 1 / 60;
let accumulator = 0, previousScroll = 0, renderAlpha = 1, renderDirty = true, frameHandle = 0, idleHandle = 0;
let resolutionScale = 1, frameAverage = 16.7, fastestFrame = 100, lastAdapt = 0, vignette = null;
const perf = { fps: 60, frameMs: 16.7, renderMs: 0, updateMs: 0, renderScale: 1, frames: 0, steps: 0 };
const environmentHit = (...args) => world.hit(...args);
const lerp = (before, after) => (before ?? after) + (after - (before ?? after)) * renderAlpha;
const controls = [{ x: 0, y: 0, fire: false }, { x: 0, y: 0, fire: false }];
const touch = { x: 0, y: 0, fire: false, pointer: null, originX: 0, originY: 0 };
const mouse = { active: false, x: 0, y: 0, fire: false, pointer: null };

try {
  audio.mute(localStorage.getItem('tyran-muted') === 'true');
  quality = localStorage.getItem('tyran-quality') === 'low' ? 'low' : 'high';
} catch { /* Local saves are optional in private/restricted browsing. */ }

function saveStatus(message) {
  for (const id of ['save-summary', 'pause-save-status', 'hangar-save-status']) setText($(id), message);
}

function saveGame(slot = 'manual') {
  if (!state || !['playing', 'hangar', 'victory'].includes(state.status)) return false;
  const result = writeSave(slot, state, {
    seed: world.seed, damage: world.damage, destroyed: world.destroyed, unlocked,
  });
  if (result.ok) saves[slot] = result;
  refreshContinue();
  saveStatus(result.ok ? `${slot === 'auto' ? 'Autosaved' : 'Game saved'} · ${saveDescription(result.run)}. Stored in this browser.`
    : 'Could not save in this browser. Your previous save is unchanged; you can keep playing.');
  return result.ok;
}

function loadGame(slot = 'manual') {
  const result = readSave(slot);
  saves[slot] = result; refreshContinue();
  if (!result.ok || !result.run) {
    saveStatus(result.error === 'corrupt' ? 'This save could not be read. Your current flight is unchanged.'
      : result.error === 'unavailable' ? 'Browser storage is unavailable. Your current flight is unchanged.' : 'There is no saved game in this slot yet.');
    return;
  }
  const run = result.run;
  state = structuredClone(run.state); mode = state.mode; unlocked = Math.max(unlocked, run.unlocked);
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
  state.width = W; state.height = H; selected = state.level;
  world.setWorld(state.level, run.seed); world.restoreDamage(run.damage, run.destroyed, run.sceneryVersion);
  warmFleet(state.level); fx.reset(); keys.clear(); clock = state.time;
  $('announcement').hidden = true; $('boss-hud').hidden = true;
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = Number(button.dataset.mode) === mode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  syncPilotHUD();
  if (run.scene === 'hangar') showHangar(0, true);
  else if (run.scene === 'end') showEnd(true, true);
  else { setScreen('pause'); $('resume-button').focus({ preventScroll: true }); }
  refreshHUD();
  saveStatus(`Loaded ${saveDescription(run)}${run.scene === 'pause' ? ' · Press Resume flight when ready.' : '.'}`);
}

function setScreen(next) {
  clearMouseControl();
  scene = next;
  for (const id of screens) if ($(id)) $(id).hidden = id !== `${next}-screen`;
  $('hud').hidden = next === 'menu';
  document.body.dataset.scene = next;
  if ($('touch-controls')) $('touch-controls').hidden = next !== 'playing';
  if (next !== 'playing') { keys.clear(); touch.x = touch.y = 0; touch.fire = false; }
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
  mouse.x = clamp(mouse.x / oldW * W, 30, W - 30); mouse.y = clamp(mouse.y / oldH * H, 105, H - 42);
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
    for (const list of [fx.particles, fx.rings, fx.lights, fx.texts, fx.wrecks]) for (const effect of list) effect.x *= W / oldW;
  }
  if (scene === 'menu') world.prepare(W, H);
  requestFrame();
}

function warmFleet(index) {
  warmShipSprites(SHIP_PALETTES[index], index);
  warmShipSprites('#a4ffee', index, true); warmShipSprites('#ffc18b', index, true);
  warmProjectileTextures(WEAPONS, BULLET_SPECTRUM);
  pickupTexture('repair'); pickupTexture('credits');
}

function announce(kicker, title, description = '', seconds = 3) {
  $('announcement-kicker').textContent = kicker;
  $('announcement-title').textContent = title;
  $('announcement-description').textContent = description;
  $('announcement').hidden = false;
  announcementUntil = clock + seconds;
}

function launch(level = 0, checkpoint = null) {
  audio.start();
  level = clamp(Math.floor(Number(level) || 0), 0, WORLDS.length - 1);
  selected = level;
  state = createCampaign(checkpoint?.mode || mode, level, checkpoint);
  state.startLevel = checkpoint?.startLevel ?? level;
  state.width = W; state.height = H; beginLevel(state, level);
  world.setWorld(level); warmFleet(level); fx.reset(); keys.clear(); previousScroll = 0; $('boss-hud').hidden = true;
  setScreen('playing');
  announce(`Sector ${String(level + 1).padStart(2, '0')} / 10`, WORLDS[level].name, WORLDS[level].subtitle || 'Clear the skies. Bring everyone home.', 3.2);
  syncPilotHUD(); saveGame('auto');
  canvas.focus({ preventScroll: true });
  refreshHUD();
}

function syncPilotHUD() {
  $('p2-panel').hidden = state.mode !== 2;
  document.querySelector('.flight-hint').textContent = state.mode === 2 ? 'P1: Mouse / WASD · Click / L Ctrl fire  ·  P2: Arrows + R Ctrl / Enter' : 'Mouse / WASD / Arrows · Click / Space / Ctrl fire · 1–6 profile';
}

function returnToMenu() {
  state = null; fx.reset(); selectWorld(selected); setScreen('menu');
  $('announcement').hidden = true; $('boss-hud').hidden = true; refreshContinue(); $('launch-button').focus({ preventScroll: true });
}

function pause() {
  if (scene === 'playing') { setScreen('pause'); $('resume-button').focus({ preventScroll: true }); }
  else if (scene === 'pause') { audio.start(); setScreen('playing'); canvas.focus({ preventScroll: true }); }
}

function refreshHUD() {
  if (!state) return;
  setText($('level-name'), WORLDS[state.level].name);
  setText($('level-number'), `${String(state.level + 1).padStart(2, '0')} / 10`);
  setText($('score-value'), number(state.score)); setText($('credits-value'), number(state.credits));
  const profile = weaponStats(state);
  setText($('weapon-value'), profile.name); setText($('weapon-level'), `MK ${String(profile.level + 1).padStart(2, '0')}`);
  const activeCombo = state.combo >= 2 && state.comboTime > 0;
  setText($('combo-value'), activeCombo ? `${state.combo} · ${comboLabel(state.combo)}` : 'READY');
  setWidth($('combo-fill'), activeCombo ? state.comboTime / 5.2 : 0);
  $('combo-instrument').classList.toggle('active', activeCombo);
  setWidth($('progress-fill'), state.time / state.duration);
  for (const p of state.players) {
    const prefix = `p${p.id + 1}`;
    setWidth($(prefix + '-hull'), p.hull / p.maxHull); setWidth($(prefix + '-shield'), p.shield / p.maxShield);
    $(prefix + '-hull').parentElement.setAttribute('aria-label', `Pilot ${p.id + 1} hull ${Math.ceil(p.hull)} of ${p.maxHull}`);
    $(prefix + '-shield').parentElement.setAttribute('aria-label', `Pilot ${p.id + 1} shield ${Math.ceil(p.shield)} of ${p.maxShield}`);
  }
  const boss = state.enemies.find(e => e.boss && !e.dead);
  $('boss-hud').hidden = !boss;
  if (boss) {
    setText($('boss-name'), WORLDS[state.level].bossName || 'Sector guardian'); setWidth($('boss-fill'), boss.hp / boss.maxHp);
    setText($('boss-status'), boss.vulnerable ? `Core exposed · ${boss.windowClock.toFixed(1)}s` : `Armor sealed · ${boss.windowClock.toFixed(1)}s`);
    $('boss-hud').classList.toggle('exposed', !!boss.vulnerable);
  }
}

function showHangar(bonus, loading = false) {
  unlocked = Math.max(unlocked, state.level + 1);
  setScreen('hangar'); $('announcement').hidden = true;
  $('hangar-title').textContent = 'Refit your ship.';
  $('hangar-subtitle').textContent = `${WORLDS[state.level].name} cleared · ${state.kills} ship${state.kills === 1 ? '' : 's'} down · ${state.destroyed} ground targets destroyed.${bonus ? ` ${number(bonus)} credits awarded.` : ''} Spend your salvage before the next launch; hull and shields will be restored.`;
  $('next-button').textContent = `Launch sector ${String(state.level + 2).padStart(2, '0')} — ${WORLDS[state.level + 1].name}  ↗`;
  $('campaign-route').innerHTML = WORLDS.map((world, index) => {
    const complete = index >= (state.startLevel || 0) && index <= state.level, current = index === state.level + 1;
    return `<li class="${complete ? 'complete' : current ? 'current' : ''}" ${current ? 'aria-current="step"' : ''}><span>${String(index + 1).padStart(2, '0')}${complete ? ' ✓' : ''}</span><strong>${world.name}</strong></li>`;
  }).join('');
  renderUpgrades(); $('next-button').focus({ preventScroll: true });
  if (!loading) saveGame('auto');
}

function renderUpgrades() {
  $('hangar-credits').textContent = number(state.credits);
  const stats = shipStats(state.upgrades), weapon = weaponStats(state);
  $('hangar-loadout').innerHTML = `<div><dt>Hull capacity</dt><dd>${stats.hull}</dd></div><div><dt>Shield capacity</dt><dd>${stats.shield}</dd></div><div><dt>Shield recharge</dt><dd>${stats.recharge}<small>/s · ${stats.delay.toFixed(1)}s delay</small></dd></div><div><dt>Armament</dt><dd>Mk ${weapon.level + 1}<small>${weapon.name}</small></dd></div>`;
  $('upgrade-list').innerHTML = UPGRADES.map(u => {
    const level = state.upgrades[u.id], maxed = level >= MAX_UPGRADE, cost = upgradeCost(state, u.id);
    const next = { ...state, upgrades: { ...state.upgrades, [u.id]: Math.min(MAX_UPGRADE, level + 1) } }, upgraded = shipStats(next.upgrades), nextWeapon = weaponStats(next);
    const preview = u.id === 'weapon' ? `${weapon.damage.toFixed(1)} → ${nextWeapon.damage.toFixed(1)} power · ${(1 / nextWeapon.interval).toFixed(1)} shots/s`
      : u.id === 'recharge' ? `${stats.recharge} → ${upgraded.recharge} shield/s · ${upgraded.delay.toFixed(1)}s delay`
      : `${stats[u.id]} → ${upgraded[u.id]} ${u.id}`;
    return `<button class="upgrade-card" data-upgrade="${u.id}" ${maxed || state.credits < cost ? 'disabled' : ''}><span class="upgrade-icon" aria-hidden="true">${u.icon}</span><span class="upgrade-level">Mk ${String(level + 1).padStart(2, '0')} / 07</span><span class="upgrade-name">${u.name}</span><span class="upgrade-description">${u.subtitle}${state.mode === 2 ? ' Upgrades both pilots.' : ''}</span><span class="upgrade-preview">${maxed ? 'Maximum performance reached' : preview}</span><span class="upgrade-pips" aria-hidden="true">${Array.from({ length: 6 }, (_, i) => `<i class="${i < level ? 'filled' : ''}"></i>`).join('')}</span><span class="upgrade-cost">${maxed ? 'Fully upgraded' : `${number(cost)} credits <span aria-hidden="true">+</span>`}</span></button>`;
  }).join('');
  renderWeapons();
}

function renderWeapons() {
  const selectedWeapon = state?.weapon || 'pulse';
  $('weapon-list').innerHTML = WEAPONS.map((weapon, index) => {
    const stats = weaponStats(state, weapon.id), active = weapon.id === selectedWeapon;
    const power = Math.round(Math.min(100, stats.damage * stats.count * 1.18));
    const speed = Math.round(Math.min(100, 100 / stats.interval * .42));
    const range = Math.round(Math.min(100, stats.speed / 12 + (stats.homing ? 18 : 0) + (stats.pierce ? 12 : 0)));
    return `<button class="weapon-card${active ? ' active' : ''}" data-weapon="${weapon.id}" aria-pressed="${active}" aria-label="Select ${weapon.name}" style="--weapon-color:${weapon.color}"><span class="weapon-hotkey">${index + 1}</span><span class="weapon-swatch"></span><span class="weapon-copy"><strong>${weapon.name}</strong><small>${weapon.tag}</small></span><span class="weapon-description">${weapon.description}</span><span class="weapon-bars" aria-label="Power ${power}, fire rate ${speed}, reach ${range}"><i style="--bar:${power}%"></i><i style="--bar:${speed}%"></i><i style="--bar:${range}%"></i></span><span class="weapon-readout"><b>${stats.damage.toFixed(1)} DMG</b><b>${(1 / stats.interval).toFixed(1)} / SEC</b></span></button>`;
  }).join('');
}

function showEnd(won, loading = false) {
  setScreen('end'); $('announcement').hidden = true;
  $('end-title').textContent = won ? 'The skies are yours.' : 'Signal lost.';
  $('end-description').textContent = won ? 'The citadel has fallen. Your campaign is complete. Start a fresh flight or return to flight command.' : `Your flight ended over ${WORLDS[state.level].name}. Retry with your current equipment or load a saved flight. Your last save is safe.`;
  $('end-score').textContent = number(state.score);
  $('retry-button').textContent = won ? 'Fly a new campaign ↗' : 'Retry sector ↗';
  if (won && !loading) { unlocked = 9; saveGame('auto'); }
  refreshContinue();
  $('retry-button').focus({ preventScroll: true });
}

function refreshContinue() {
  const auto = saves.auto.run, manual = saves.manual.run;
  $('continue-button').hidden = !auto; $('continue-button').disabled = !auto; $('load-game-button').disabled = !manual;
  $('continue-button').textContent = auto ? `Continue · ${saveDescription(auto)}` : 'Continue campaign';
  $('load-game-button').textContent = manual ? `Load game · ${saveDescription(manual)}` : 'Load game';
  for (const id of ['pause-load-button', 'hangar-load-button', 'end-load-button']) {
    $(id).disabled = !manual && (!auto || auto.scene === 'end');
    $(id).textContent = manual ? 'Load game' : 'Load autosave';
  }
  if (auto || manual) {
    const latest = !auto || (manual && manual.savedAt > auto.savedAt) ? manual : auto;
    const when = latest.savedAt ? new Date(latest.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Previous campaign';
    setText($('save-summary'), `${when} · ${latest.state.mode === 2 ? 'Co-op' : 'Solo'} · ${number(latest.state.credits)} credits. Manual save is kept separately from autosave.`);
  } else setText($('save-summary'), Object.values(saves).some(save => save.error === 'unavailable')
    ? 'Browser storage is unavailable. You can still play.'
    : Object.values(saves).some(save => save.error === 'corrupt') ? 'A saved game could not be read. You can start a new campaign.' : 'No saved flights yet. Progress saves automatically; Save game keeps a separate manual slot.');
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
  $('sector-flight-button').textContent = `Fly selected sector · ${String(selected + 1).padStart(2, '0')} ↗`;
  renderDirty = true; requestFrame();
}

function input() {
  const solo = state?.mode !== 2;
  controls[0].x = Number(keys.has('KeyD') || solo && keys.has('ArrowRight')) - Number(keys.has('KeyA') || solo && keys.has('ArrowLeft')) + touch.x;
  controls[0].y = Number(keys.has('KeyS') || solo && keys.has('ArrowDown')) - Number(keys.has('KeyW') || solo && keys.has('ArrowUp')) + touch.y;
  const keyboardMovement = keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD') || solo && (keys.has('ArrowUp') || keys.has('ArrowLeft') || keys.has('ArrowDown') || keys.has('ArrowRight'));
  const pilot = state?.players[0];
  if (mouse.active && pilot?.alive && !keyboardMovement && touch.pointer === null) {
    // Ask the existing momentum model for velocity instead of moving the ship
    // directly. Braking against current velocity prevents cursor overshoot, and
    // heavier equipment keeps its slower acceleration and settling response.
    const response = .095 * pilot.mass, frequency = 10 / Math.sqrt(pilot.mass);
    const gain = response * frequency * frequency, braking = 2 * response * frequency - 1;
    controls[0].x = (gain * (mouse.x - pilot.x) - braking * pilot.vx) / PLAYER_SPEED;
    controls[0].y = (gain * (mouse.y - pilot.y) - braking * pilot.vy) / PLAYER_SPEED;
  }
  controls[0].fire = mouse.fire || keys.has('ControlLeft') || keys.has('Space') || touch.fire || solo && (keys.has('ControlRight') || keys.has('Enter'));
  controls[1].x = solo ? 0 : Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
  controls[1].y = solo ? 0 : Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
  controls[1].fire = !solo && (keys.has('ControlRight') || keys.has('Enter'));
  return controls;
}

function processEvents() {
  const groundOffset = (world.parallaxX || 0) * W / 1200;
  for (const e of state.events.splice(0)) {
    fx.emit(e, state.scroll * W / 1200, groundOffset); audio.effect(e.type, e.size, e.weapon || e.label);
    if (e.type === 'explosion' && !e.ground) {
      const blast = e.blast || 1;
      for (const prop of world.hit(e.x, e.y, Math.min(250, e.size * 1.5 * blast), e.size * 2 * blast, state.scroll)) {
        state.destroyed++; state.credits += prop.value || 4; state.score += 25;
        applyStructureBlast(state, prop);
        fx.emit({ type: 'explosion', ...prop, size: Math.min(48, prop.size), ground: true }, state.scroll * W / 1200, groundOffset);
      }
      if (e.player && state.mode === 2 && state.players.some(p => p.alive)) announce('Wingmate down', 'Bring them home.', 'Finish the sector to restore both ships.', 2.5);
    }
    if (e.type === 'boss') announce('Warning · heavy signature', WORLDS[state.level].bossName, 'Break through its armor. Watch for changing attack patterns.', 3);
    if (e.type === 'phase') announce('Reactor surge', 'Guardian enraged', 'New attack pattern detected.', 1.6);
    if (e.type === 'boss-open' && e.openCount === 1) announce('Window open', 'Core exposed', 'Aim for the glowing weak points before the armor seals.', 1.5);
    if (e.type === 'formation') announce('Tactical formation', e.label, `${e.count} contacts moving as one.`, 1.15);
    if (e.type === 'weapon') { refreshHUD(); renderWeapons(); }
    if (e.type === 'hangar') showHangar(e.bonus);
    if (e.type === 'defeat') showEnd(false);
    if (e.type === 'victory') showEnd(true);
  }
}

const pickupTextures = new Map();
function pickupTexture(kind) {
  const repair = kind === 'repair', key = repair ? 0 : 1;
  if (pickupTextures.has(key)) return pickupTextures.get(key);
  const out = document.createElement('canvas'); out.width = out.height = 96;
  const paint = out.getContext('2d'), color = repair ? '#aaffd0' : '#ffdc90';
  // The same restrained green halo marks every collectible as beneficial;
  // the repair capsule and gold credit chips keep their distinct body colors.
  const glow = paint.createRadialGradient(48, 48, 10, 48, 48, 45);
  glow.addColorStop(0, '#6bf3a04d'); glow.addColorStop(.4, '#62e99526'); glow.addColorStop(1, '#62e99500');
  paint.fillStyle = glow; paint.fillRect(0, 0, 96, 96);
  const source = spriteCell('pickups', key);
  if (source) {
    const scale = 58 / Math.max(source.width, source.height), width = source.width * scale, height = source.height * scale;
    paint.shadowColor = '#02080dcc'; paint.shadowBlur = 5; paint.shadowOffsetY = 4;
    paint.drawImage(source, 48 - width / 2, 48 - height / 2, width, height);
  } else {
    paint.fillStyle = color; paint.font = 'bold 42px sans-serif'; paint.textAlign = 'center'; paint.textBaseline = 'middle';
    paint.fillText(repair ? '+' : '•', 48, 48);
  }
  pickupTextures.set(key, out); return out;
}

function drawBullet(b) {
  const sprite = projectileTexture(b), layout = projectileLayout(b);
  ctx.save();
  ctx.translate(lerp(b.px, b.x), lerp(b.py, b.y));
  ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
  // Hull-sized ammunition stays readable over bright terrain. Bloom is baked.
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(sprite, -layout.width / 2, -layout.height / 2 + layout.offsetY, layout.width, layout.height);
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
        const members = state.enemies.filter(enemy => enemy.formation === formation && !enemy.dead);
        if (members.length < 2) continue;
        ctx.beginPath(); members.forEach((enemy, i) => { const x = lerp(enemy.px, enemy.x), y = lerp(enemy.py, enemy.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
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
      ctx.drawImage(pickupTexture(pickup.kind), pickup.x - 32, pickup.y - 32, 64, 64);
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const b of state.bullets) drawBullet(b);
    ctx.restore();
    for (const p of state.players) if (p.alive) {
      const color = p.id ? '#ffc18b' : '#a4ffee', x = lerp(p.px, p.x), y = lerp(p.py, p.y);
      drawShip(ctx, x, y, 30, 'player', color, clock, { hit: p.hurt > .2 ? 1 : 0, player: p.id, world: index, thrust: p.thrust, quality, motion: !fx.reduced });
      if (p.shield > 1) {
        ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = .08 + p.shield / p.maxShield * .13 + (p.hurt > 0 ? .45 : 0);
        ctx.beginPath(); ctx.ellipse(0, 0, 37, 46, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha *= .36; ctx.fillStyle = color; ctx.fill(); ctx.restore();
      }
      ctx.fillStyle = color; ctx.globalAlpha = .65; ctx.textAlign = 'center'; ctx.font = '10px "Space Grotesk", sans-serif'; ctx.fillText(`P${p.id + 1}`, x, y + 70); ctx.globalAlpha = 1;
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
  const blur = quality === 'high' && !fx.reduced && impactMotion && fx.shake > 8 ? Math.min(.85, fx.shake * .045) : 0;
  const filter = blur ? `blur(${(Math.round(blur * 10) / 10).toFixed(1)}px)` : '';
  if (canvas.style.filter !== filter) canvas.style.filter = filter;
}

function frame(time) {
  frameHandle = 0;
  if (document.hidden) { lastTime = 0; return; }
  const elapsed = lastTime ? Math.max(0, (time - lastTime) / 1000) : 0;
  const dt = Math.min(.1, elapsed); lastTime = time;
  const preview = scene === 'menu' && document.body.dataset.preview === 'true';
  const fading = scene === 'end' && (fx.particles.length || fx.rings.length || fx.delayed.length || fx.texts.length || fx.lights.length || fx.flash > .01 || fx.shake > .3);
  const active = scene === 'playing' || preview || fading;
  if (active) clock += dt;
  if (scene === 'playing' && state) {
    const started = performance.now();
    accumulator = Math.min(.1, accumulator + dt);
    while (accumulator + 1e-9 >= STEP && scene === 'playing') {
      previousScroll = state.scroll;
      update(state, STEP, input(), environmentHit);
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

const controlledKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight', 'Space', 'Enter']);
window.addEventListener('keydown', event => {
  const modal = [...document.querySelectorAll('.modal-screen')].reverse().find(el => !el.hidden);
  if (event.code === 'Tab' && modal) {
    const focusable = [...modal.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1), current = document.activeElement;
    if (!modal.contains(current) || (event.shiftKey && current === first) || (!event.shiftKey && current === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
    return;
  }
  const weaponIndex = /^Digit([1-6])$/.exec(event.code);
  if (weaponIndex && state && (scene === 'playing' || scene === 'hangar') && !event.repeat) {
    event.preventDefault();
    const weapon = WEAPONS[Number(weaponIndex[1]) - 1];
    if (weapon && selectWeapon(state, weapon.id)) {
      audio.start(); audio.effect('weapon'); refreshHUD();
      if (scene === 'hangar') { renderUpgrades(); saveGame('auto'); }
      else renderWeapons();
    }
    return;
  }
  if (scene === 'playing' && controlledKeys.has(event.code)) {
    event.preventDefault(); keys.add(event.code);
    if (!event.repeat && (/^Key[WASD]$/.test(event.code) || state?.mode !== 2 && event.code.startsWith('Arrow'))) mouse.active = false;
  }
  if ((event.code === 'Escape' || event.code === 'KeyP') && !event.repeat) {
    if ($('help-screen') && !$('help-screen').hidden) closeHelp(); else pause();
  }
  if (event.code === 'KeyM' && !event.repeat) toggleSound();
}, { capture: true });
window.addEventListener('keyup', event => { keys.delete(event.code); if (scene === 'playing' && controlledKeys.has(event.code)) event.preventDefault(); }, { capture: true });
window.addEventListener('blur', () => { keys.clear(); clearMouseControl(); if (scene === 'playing') pause(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && scene === 'playing') pause();
  if (!document.hidden) { lastTime = 0; renderDirty = true; requestFrame(); }
});
window.addEventListener('resize', resize);
canvas.addEventListener('contextmenu', e => e.preventDefault());
function clearMouseControl() {
  mouse.active = false; mouse.fire = false;
  const pointer = mouse.pointer; mouse.pointer = null;
  if (pointer !== null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
}
function mouseTarget(event, activate = true) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  mouse.x = clamp((event.clientX - rect.left) / rect.width * W, 30, W - 30);
  mouse.y = clamp((event.clientY - rect.top) / rect.height * H, 105, H - 42);
  if (activate) mouse.active = true;
}
canvas.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || scene !== 'playing') return;
  mouseTarget(event);
  if (!(event.buttons & 1)) mouse.fire = false;
});
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || scene !== 'playing') return;
  mouseTarget(event, false); mouse.fire = true; mouse.pointer = event.pointerId;
  canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); audio.start(); event.preventDefault();
});
function releaseMouseFire(event) {
  if (event.pointerType !== 'mouse' || event.pointerId !== mouse.pointer || event.type === 'pointerup' && event.button !== 0) return;
  mouse.fire = false;
  if (event.type !== 'pointerup') mouse.active = false;
  const pointer = mouse.pointer; mouse.pointer = null;
  if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
}
window.addEventListener('pointerup', releaseMouseFire, { capture: true });
window.addEventListener('pointercancel', releaseMouseFire, { capture: true });
canvas.addEventListener('lostpointercapture', releaseMouseFire);
function on(id, fn) { $(id)?.addEventListener('click', fn); }
on('launch-button', () => launch(0));
on('sector-flight-button', () => launch(selected));
on('continue-button', () => loadGame('auto'));
on('load-game-button', () => loadGame('manual'));
for (const id of ['pause-save-button', 'hangar-save-button']) on(id, () => saveGame('manual'));
for (const id of ['pause-load-button', 'hangar-load-button', 'end-load-button']) on(id, () => loadGame(saves.manual.run ? 'manual' : 'auto'));
on('hangar-menu-button', returnToMenu);
on('pause-button', pause); on('resume-button', pause); on('menu-button', returnToMenu); on('end-menu-button', returnToMenu);
on('restart-button', () => launch(state.level, state));
on('retry-button', () => state.status === 'victory' ? launch(0) : launch(state.level, state));
on('next-button', () => {
  if (state?.status !== 'hangar') return;
  beginLevel(state, state.level + 1); world.setWorld(state.level); warmFleet(state.level); previousScroll = 0; fx.reset(); setScreen('playing'); audio.start(); $('boss-hud').hidden = true;
  announce(`Sector ${String(state.level + 1).padStart(2, '0')} / 10`, WORLDS[state.level].name, WORLDS[state.level].subtitle, 3); refreshHUD(); canvas.focus({ preventScroll: true });
  saveGame('auto');
});
$('upgrade-list').addEventListener('click', event => {
  const button = event.target.closest('[data-upgrade]'); if (!button || !state) return;
  if (buyUpgrade(state, button.dataset.upgrade)) { audio.effect('upgrade'); renderUpgrades(); saveGame('auto'); const next = document.querySelector(`[data-upgrade="${button.dataset.upgrade}"]`); if (!next.disabled) next.focus(); else $('next-button').focus(); }
});
$('weapon-list').addEventListener('click', event => {
  const button = event.target.closest('[data-weapon]'); if (!button || !state) return;
  if (selectWeapon(state, button.dataset.weapon)) {
    audio.start(); audio.effect('weapon'); renderUpgrades(); refreshHUD();
    if (scene === 'hangar') saveGame('auto');
    document.querySelector(`[data-weapon="${button.dataset.weapon}"]`).focus({ preventScroll: true });
  }
});
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = Number(button.dataset.mode);
  document.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
}));

function toggleSound() {
  audio.mute(!audio.muted); audio.start(); syncSettings();
  try { localStorage.setItem('tyran-muted', String(audio.muted)); } catch { /* optional */ }
}
function syncSettings() {
  $('sound-toggle').setAttribute('aria-pressed', String(!audio.muted)); $('sound-toggle').setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
  $('sound-toggle').dataset.muted = String(audio.muted); $('sound-toggle').title = audio.muted ? 'Sound off · M' : 'Sound on · M';
  if ($('sound-label')) $('sound-label').textContent = audio.muted ? 'Sound off' : 'Sound on';
  const qualityText = quality === 'high' ? 'Effects high' : 'Effects low';
  if ($('quality-label')) $('quality-label').textContent = qualityText; else $('quality-toggle').textContent = qualityText;
  $('quality-toggle').setAttribute('aria-label', `Effects ${quality}. Click to switch.`); $('quality-toggle').setAttribute('aria-pressed', String(quality === 'high'));
  if ($('pause-sound-toggle')) { $('pause-sound-toggle').textContent = audio.muted ? 'Sound off · M' : 'Sound on · M'; $('pause-sound-toggle').setAttribute('aria-pressed', String(!audio.muted)); }
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

const stick = $('touch-stick'), fire = $('touch-fire');
if (stick) {
  stick.addEventListener('pointerdown', e => { mouse.active = false; touch.pointer = e.pointerId; touch.originX = e.clientX; touch.originY = e.clientY; stick.setPointerCapture(e.pointerId); e.preventDefault(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId !== touch.pointer) return; touch.x = clamp((e.clientX - touch.originX) / 42, -1, 1); touch.y = clamp((e.clientY - touch.originY) / 42, -1, 1); stick.style.setProperty('--stick-x', `${touch.x * 24}px`); stick.style.setProperty('--stick-y', `${touch.y * 24}px`); });
  const release = () => { touch.pointer = null; touch.x = touch.y = 0; stick.style.setProperty('--stick-x', '0px'); stick.style.setProperty('--stick-y', '0px'); };
  stick.addEventListener('pointerup', release); stick.addEventListener('pointercancel', release); stick.addEventListener('lostpointercapture', release);
}
if (fire) {
  fire.addEventListener('pointerdown', e => { touch.fire = true; fire.setPointerCapture(e.pointerId); audio.start(); e.preventDefault(); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) fire.addEventListener(name, () => { touch.fire = false; });
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
  step(seconds, controls = []) { for (let i = 0; i < Math.ceil(seconds * 60); i++) { if (state && scene === 'playing') { previousScroll = state.scroll; update(state, STEP, controls, environmentHit); processEvents(); } } accumulator = 0; renderAlpha = 1; renderDirty = true; refreshHUD(); requestFrame(); },
};
document.body.dataset.ready = 'true';
$('menu-screen').inert = false;
$('startup-status').hidden = true;
requestFrame();
