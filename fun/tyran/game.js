import { WORLDS, WorldRenderer } from './worlds.js';
import { ENEMY_TYPES, SHIP_PALETTES, drawShip, warmShipSprites } from './ships.js';
import { createCampaign, beginLevel, update, buyUpgrade, upgradeCost, UPGRADES, WEAPONS, MAX_UPGRADE, clamp, selectWeapon, weaponStats, bossWeakPointPosition, comboLabel } from './sim.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';

const elements = new Map();
const $ = id => { if (!elements.has(id)) { const el = document.getElementById(id); if (el) elements.set(id, el); } return elements.get(id); };
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const setWidth = (el, fraction) => { const width = `${(clamp(fraction, 0, 1) * 100).toFixed(1)}%`; if (el.style.width !== width) el.style.width = width; };
const canvas = $('game-canvas'), ctx = canvas.getContext('2d', { alpha: false });
const world = new WorldRenderer(), fx = new Effects(), audio = new AudioEngine();
const keys = new Set(), numberFormat = new Intl.NumberFormat('en-US'), number = n => numberFormat.format(Math.floor(n || 0));
const screens = ['menu-screen', 'pause-screen', 'hangar-screen', 'end-screen'];
const SAVE_KEY = 'tyran-campaign-v1';
let state = null, mode = 1, selected = 0, scene = 'menu', unlocked = 0, saved = null;
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

try {
  const stored = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (stored?.version === 1) {
    unlocked = clamp(Math.floor(Number(stored.unlocked) || 0), 0, 9);
    if (stored.checkpoint && Number.isInteger(stored.checkpoint.level) && stored.checkpoint.level >= 1 && stored.checkpoint.level <= 9) saved = stored.checkpoint;
  }
  audio.mute(localStorage.getItem('tyran-muted') === 'true');
  quality = localStorage.getItem('tyran-quality') === 'low' ? 'low' : 'high';
} catch { /* Local saves are optional in private/restricted browsing. */ }

function saveCheckpoint(nextLevel = state?.level + 1) {
  if (state && nextLevel < 10) saved = { level: nextLevel, mode: state.mode, weapon: state.weapon, upgrades: { ...state.upgrades }, credits: state.credits, score: state.score, totalKills: state.totalKills };
  else saved = null;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, unlocked, checkpoint: saved })); } catch { /* Keep playing without storage. */ }
  refreshContinue();
}

function setScreen(next) {
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
  sizeSurface(rect);
  if (state) {
    state.width = W; state.height = H;
    for (const p of state.players) { p.x = clamp(p.x / oldW * W, 30, W - 30); p.y = p.y / oldH * H; p.px = p.x; p.py = p.y; }
    for (const e of state.enemies) { e.x = e.x / oldW * W; e.originX = e.originX / oldW * W; e.px = e.x; e.py = e.y; }
    for (const b of state.bullets) { b.x *= W / oldW; b.px = b.x; b.py = b.y; }
    for (const p of state.pickups) p.x *= W / oldW;
    for (const list of [fx.particles, fx.rings, fx.lights, fx.texts, fx.wrecks]) for (const effect of list) effect.x *= W / oldW;
  }
  requestFrame();
}

function warmFleet(index) {
  warmShipSprites(SHIP_PALETTES[index], index);
  warmShipSprites('#a4ffee', index, true); warmShipSprites('#ffc18b', index, true);
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
  state = createCampaign(checkpoint?.mode || mode, level, checkpoint);
  state.width = W; state.height = H; beginLevel(state, level);
  world.setWorld(level); warmFleet(level); fx.reset(); keys.clear(); previousScroll = 0; $('boss-hud').hidden = true;
  setScreen('playing');
  announce(`SECTOR ${String(level + 1).padStart(2, '0')} / 10`, WORLDS[level].name, WORLDS[level].subtitle || 'Clear the skies. Bring everyone home.', 3.2);
  $('p2-panel').hidden = state.mode !== 2;
  document.querySelector('.flight-hint').textContent = state.mode === 2 ? 'P1: WASD + L CTRL  ·  P2: ARROWS + ENTER / R CTRL  ·  1–6 PROFILE' : 'WASD / ARROWS  ·  SPACE / CTRL FIRE  ·  1–6 PROFILE';
  canvas.focus({ preventScroll: true });
  refreshHUD();
}

function returnToMenu() {
  state = null; fx.reset(); world.setWorld(selected); setScreen('menu');
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
    setText($('boss-status'), boss.vulnerable ? `CORE EXPOSED · ${boss.windowClock.toFixed(1)}s` : `ARMOR SEALED · ${boss.windowClock.toFixed(1)}s`);
    $('boss-hud').classList.toggle('exposed', !!boss.vulnerable);
  }
}

function showHangar(bonus) {
  unlocked = Math.max(unlocked, state.level + 1);
  saveCheckpoint(); setScreen('hangar'); $('announcement').hidden = true;
  $('hangar-title').textContent = 'A little more firepower.';
  $('hangar-subtitle').textContent = `${WORLDS[state.level].name} cleared · ${state.kills} ships down · ${state.destroyed} structures destroyed · ${number(bonus)} CR sector bonus. Both hull and shields restored at launch.`;
  $('next-button').textContent = `Launch sector ${String(state.level + 2).padStart(2, '0')} — ${WORLDS[state.level + 1].name}  ↗`;
  renderUpgrades(); $('next-button').focus({ preventScroll: true });
}

function renderUpgrades() {
  $('hangar-credits').textContent = number(state.credits);
  $('upgrade-list').innerHTML = UPGRADES.map(u => {
    const level = state.upgrades[u.id], maxed = level >= MAX_UPGRADE, cost = upgradeCost(state, u.id);
    return `<button class="upgrade-card" data-upgrade="${u.id}" ${maxed || state.credits < cost ? 'disabled' : ''}><span class="upgrade-icon" aria-hidden="true">${u.icon}</span><span class="upgrade-level">MK ${String(level + 1).padStart(2, '0')} / 07</span><span class="upgrade-name">${u.name}</span><span class="upgrade-description">${u.subtitle}${state.mode === 2 ? ' Upgrades both pilots.' : ''}</span><span class="upgrade-pips" aria-hidden="true">${Array.from({ length: 6 }, (_, i) => `<i class="${i < level ? 'filled' : ''}"></i>`).join('')}</span><span class="upgrade-cost">${maxed ? 'FULLY UPGRADED' : `${number(cost)} CR <span aria-hidden="true">+</span>`}</span></button>`;
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

function showEnd(won) {
  setScreen('end'); $('announcement').hidden = true;
  $('end-title').textContent = won ? 'The skies are yours.' : 'Signal lost.';
  $('end-description').textContent = won ? 'Ten worlds liberated. One very well-used ship. Your flight will be remembered.' : `Your flight ended over ${WORLDS[state.level].name}. Retry this sector with your current equipment. Your last hangar checkpoint is safe.`;
  $('end-score').textContent = number(state.score);
  $('retry-button').textContent = won ? 'Fly a new campaign ↗' : 'Retry sector ↗';
  if (won) { unlocked = 9; saveCheckpoint(10); }
  $('retry-button').focus({ preventScroll: true });
}

function refreshContinue() {
  let button = $('continue-button');
  if (!button) { button = document.createElement('button'); button.id = 'continue-button'; button.className = 'continue-button'; $('launch-button').after(button); button.addEventListener('click', () => { if (saved) launch(saved.level, saved); }); }
  button.hidden = !saved;
  if (saved) button.textContent = `Continue campaign · Sector ${String(saved.level + 1).padStart(2, '0')} ↗`;
}

function selectWorld(index) {
  selected = index; world.setWorld(index); previewScroll = 0;
  document.documentElement.style.setProperty('--sector-accent', WORLDS[index].accent || WORLDS[index].color);
  $('world-list').querySelectorAll('[data-world]').forEach((button, i) => { button.classList.toggle('active', i === index); button.setAttribute('aria-pressed', String(i === index)); });
  for (const id of ['selected-world-name', 'preview-world-name']) if ($(id)) $(id).textContent = WORLDS[index].name;
  if ($('selected-world-description')) $('selected-world-description').textContent = WORLDS[index].description || WORLDS[index].subtitle;
  if ($('preview-world-number')) $('preview-world-number').textContent = `SECTOR ${String(index + 1).padStart(2, '0')}`;
  document.body.dataset.world = index;
  renderDirty = true; requestFrame();
}

function input() {
  const solo = state?.mode !== 2;
  controls[0].x = Number(keys.has('KeyD') || solo && keys.has('ArrowRight')) - Number(keys.has('KeyA') || solo && keys.has('ArrowLeft')) + touch.x;
  controls[0].y = Number(keys.has('KeyS') || solo && keys.has('ArrowDown')) - Number(keys.has('KeyW') || solo && keys.has('ArrowUp')) + touch.y;
  controls[0].fire = keys.has('ControlLeft') || keys.has('Space') || touch.fire || solo && (keys.has('ControlRight') || keys.has('Enter'));
  controls[1].x = solo ? 0 : Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
  controls[1].y = solo ? 0 : Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
  controls[1].fire = !solo && (keys.has('ControlRight') || keys.has('Enter'));
  return controls;
}

function processEvents() {
  for (const e of state.events.splice(0)) {
    fx.emit(e, state.scroll * W / 1200); audio.effect(e.type, e.size, e.weapon || e.label);
    if (e.type === 'explosion' && !e.ground) {
      const blast = e.blast || 1;
      for (const prop of world.hit(e.x, e.y, Math.min(250, e.size * 1.5 * blast), e.size * 2 * blast, state.scroll)) {
        state.destroyed++; state.credits += prop.value || 4; state.score += 25;
        fx.emit({ type: 'explosion', ...prop, size: Math.min(48, prop.size), ground: true }, state.scroll * W / 1200);
      }
      if (e.player && state.mode === 2 && state.players.some(p => p.alive)) announce('WINGMATE DOWN', 'Bring them home.', 'Finish the sector to restore both ships.', 2.5);
    }
    if (e.type === 'boss') announce('WARNING · HEAVY SIGNATURE', WORLDS[state.level].bossName, 'Break through its armor. Watch for changing attack patterns.', 3);
    if (e.type === 'phase') announce('REACTOR SURGE', 'Guardian enraged', 'New attack pattern detected.', 1.6);
    if (e.type === 'boss-open' && e.openCount === 1) announce('WINDOW OPEN', 'Core exposed', 'Aim for the glowing weak points before the armor seals.', 1.5);
    if (e.type === 'formation') announce('TACTICAL FORMATION', e.label, `${e.count} contacts moving as one.`, 1.15);
    if (e.type === 'weapon') { refreshHUD(); renderWeapons(); }
    if (e.type === 'hangar') showHangar(e.bonus);
    if (e.type === 'defeat') showEnd(false);
    if (e.type === 'victory') showEnd(true);
  }
}

const boltTextures = new Map();
function boltTexture(b) {
  const friendly = b.team >= 0, color = b.weaponColor || b.color, key = `${friendly}:${color}`;
  if (boltTextures.has(key)) return boltTextures.get(key);
  const c = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(64, 64);
  c.width = c.height = 64;
  const paint = c.getContext('2d');
  if (friendly) {
    const g = paint.createLinearGradient(14, 0, 50, 0);
    g.addColorStop(0, `${color}00`); g.addColorStop(.5, `${color}70`); g.addColorStop(1, `${color}00`);
    paint.fillStyle = g; paint.fillRect(14, 4, 36, 50);
    paint.fillStyle = color; paint.fillRect(29, 3, 6, 46);
    paint.fillStyle = '#f4fff9'; paint.fillRect(31, 3, 2, 43);
  } else {
    const g = paint.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, `${color}aa`); g.addColorStop(.4, `${color}45`); g.addColorStop(1, `${color}00`);
    paint.fillStyle = g; paint.fillRect(0, 0, 64, 64);
    paint.fillStyle = color; paint.beginPath(); paint.arc(32, 32, 10.66, 0, Math.PI * 2); paint.fill();
    paint.fillStyle = '#fff4d7'; paint.beginPath(); paint.arc(30, 30, 4.5, 0, Math.PI * 2); paint.fill();
  }
  boltTextures.set(key, c); return c;
}
function drawBullet(b) {
  const x = lerp(b.px, b.x), y = lerp(b.py, b.y), color = b.weaponColor || b.color || '#ffffff';
  if (b.team < 0) { const sprite = boltTexture(b); ctx.drawImage(sprite, x - b.radius * 3, y - b.radius * 3, b.radius * 6, b.radius * 6); return; }
  const kind = b.kind || 'pulse';
  if (kind === 'lance') {
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = .9; ctx.lineWidth = Math.max(2, b.radius * 1.15);
    ctx.beginPath(); ctx.moveTo(lerp(b.px, b.x), lerp(b.py, b.y)); ctx.lineTo(lerp(b.px, b.x) - b.vx * .045, lerp(b.py, b.y) - b.vy * .045); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.globalAlpha = .8; ctx.lineWidth = .9; ctx.stroke(); ctx.restore(); return;
  }
  if (kind === 'plasma') {
    ctx.save(); const radius = b.radius * (1 + Math.sin((b.age || 0) * 18) * .08); ctx.fillStyle = color; ctx.globalAlpha = .82;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = .3; ctx.beginPath(); ctx.arc(x, y, radius * 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); return;
  }
  if (kind === 'seeker') {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2); ctx.fillStyle = color; ctx.globalAlpha = .95;
    ctx.beginPath(); ctx.moveTo(0, -b.radius * 1.8); ctx.lineTo(b.radius * 1.05, b.radius); ctx.lineTo(0, b.radius * .55); ctx.lineTo(-b.radius * 1.05, b.radius); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = .35; ctx.fillRect(-b.radius * .5, b.radius, b.radius, b.radius * 3.2); ctx.restore(); return;
  }
  if (kind === 'arc') {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, b.radius * .8); ctx.globalAlpha = .9;
    ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo((b.px + x) / 2 + Math.sin((b.age || 0) * 40) * 3, (b.py + y) / 2); ctx.lineTo(x, y); ctx.stroke(); ctx.restore(); return;
  }
  if (kind === 'scatter') {
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(x, y, b.radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = .32; ctx.beginPath(); ctx.arc(x, y, b.radius * 2.4, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return;
  }
  const sprite = boltTexture(b); ctx.drawImage(sprite, x - b.radius * 4, y - 10, b.radius * 8, 44);
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
  world.draw(ctx, W, H, scroll, clock, quality);
  fx.drawGround(ctx, scroll * W / 1200, H);
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
      drawShip(ctx, x, y, e.radius * (e.type < 2 ? 1.35 : 1), e.type, palette?.primary || WORLDS[index].enemyColor || '#b07355', clock, { hit: e.hurt / .07 * .3, phase: e.phase, world: index, quality, bank: e.bank, thrust: e.thrust, palette });
      drawBossWeakPoints(e, clock);
      if (!e.boss && e.hp < e.maxHp && e.radius >= 24) {
        ctx.fillStyle = '#09171aca'; ctx.fillRect(x - e.radius, y - e.radius * 1.6 - 8, e.radius * 2, 3);
        ctx.fillStyle = '#fb9f7c'; ctx.fillRect(x - e.radius, y - e.radius * 1.6 - 8, e.radius * 2 * Math.max(0, e.hp / e.maxHp), 3);
      }
    }
    for (const pickup of state.pickups) {
      ctx.save(); ctx.translate(pickup.x, pickup.y); ctx.rotate(clock * .8); ctx.strokeStyle = pickup.kind === 'repair' ? '#aaffd0' : '#ffdc90'; ctx.fillStyle = '#153634bb'; ctx.lineWidth = 2;
      ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = quality === 'high' ? 15 : 0;
      ctx.strokeRect(-10, -10, 20, 20); ctx.fillRect(-10, -10, 20, 20); ctx.rotate(-clock * .8); ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(pickup.kind === 'repair' ? '+' : '•', 0, 0); ctx.restore();
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const b of state.bullets) drawBullet(b);
    ctx.restore();
    for (const p of state.players) if (p.alive) {
      const color = p.id ? '#ffc18b' : '#a4ffee', x = lerp(p.px, p.x), y = lerp(p.py, p.y);
      drawShip(ctx, x, y, 30, 'player', color, clock, { bank: p.bank, hit: p.hurt > .2 ? 1 : 0, player: p.id, world: index, thrust: p.thrust, quality });
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
    const px = W * .66 + Math.sin(clock * .5) * 45, py = H * .57 + Math.cos(clock * .8) * 15;
    drawShip(ctx, px, py, 45, 'player', '#9bfff0', clock, { bank: Math.sin(clock * .5) * .07, world: index, quality });
    drawShip(ctx, px + 145, py + 115, 25, 'player', '#ffd0a0', clock, { world: index, quality });
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
    const started = performance.now(), flightInput = input();
    accumulator = Math.min(.1, accumulator + dt);
    while (accumulator + 1e-9 >= STEP && scene === 'playing') {
      previousScroll = state.scroll;
      update(state, STEP, flightInput, environmentHit);
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
    if (weapon && selectWeapon(state, weapon.id)) { audio.start(); audio.effect('weapon'); renderWeapons(); refreshHUD(); }
    return;
  }
  if (scene === 'playing' && controlledKeys.has(event.code)) { event.preventDefault(); keys.add(event.code); }
  if ((event.code === 'Escape' || event.code === 'KeyP') && !event.repeat) {
    if ($('help-screen') && !$('help-screen').hidden) closeHelp(); else pause();
  }
  if (event.code === 'KeyM' && !event.repeat) toggleSound();
}, { capture: true });
window.addEventListener('keyup', event => { keys.delete(event.code); if (scene === 'playing' && controlledKeys.has(event.code)) event.preventDefault(); }, { capture: true });
window.addEventListener('blur', () => { keys.clear(); if (scene === 'playing') pause(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && scene === 'playing') pause();
  if (!document.hidden) { lastTime = 0; renderDirty = true; requestFrame(); }
});
window.addEventListener('resize', resize);
canvas.addEventListener('contextmenu', e => e.preventDefault());
function on(id, fn) { $(id)?.addEventListener('click', fn); }
on('launch-button', () => launch(0));
on('pause-button', pause); on('resume-button', pause); on('menu-button', returnToMenu); on('end-menu-button', returnToMenu);
on('restart-button', () => launch(state.level, state));
on('retry-button', () => state.status === 'victory' ? launch(0) : launch(state.level, state));
on('next-button', () => {
  if (state?.status !== 'hangar') return;
  beginLevel(state, state.level + 1); world.setWorld(state.level); warmFleet(state.level); previousScroll = 0; fx.reset(); setScreen('playing'); audio.start(); $('boss-hud').hidden = true;
  announce(`SECTOR ${String(state.level + 1).padStart(2, '0')} / 10`, WORLDS[state.level].name, WORLDS[state.level].subtitle, 3); refreshHUD(); canvas.focus({ preventScroll: true });
});
$('upgrade-list').addEventListener('click', event => {
  const button = event.target.closest('[data-upgrade]'); if (!button || !state) return;
  if (buyUpgrade(state, button.dataset.upgrade)) { audio.effect('upgrade'); saveCheckpoint(); renderUpgrades(); const next = document.querySelector(`[data-upgrade="${button.dataset.upgrade}"]`); if (!next.disabled) next.focus(); else $('next-button').focus(); }
});
$('weapon-list').addEventListener('click', event => {
  const button = event.target.closest('[data-weapon]'); if (!button || !state) return;
  if (selectWeapon(state, button.dataset.weapon)) { audio.start(); audio.effect('weapon'); renderWeapons(); refreshHUD(); button.focus({ preventScroll: true }); }
});
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = Number(button.dataset.mode);
  document.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
}));

function toggleSound() {
  audio.start(); audio.mute(!audio.muted); syncSettings();
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
  stick.addEventListener('pointerdown', e => { touch.pointer = e.pointerId; touch.originX = e.clientX; touch.originY = e.clientY; stick.setPointerCapture(e.pointerId); e.preventDefault(); });
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
  get state() { return state; }, get scene() { return scene; }, get world() { return world; }, worlds: WORLDS, enemyTypes: ENEMY_TYPES, weapons: WEAPONS, shipPalettes: SHIP_PALETTES,
  get performance() { return { ...perf, interpolation: renderAlpha, fixedStep: STEP }; },
  launch, selectWorld, selectWeapon, pause,
  step(seconds, controls = []) { for (let i = 0; i < Math.ceil(seconds * 60); i++) { if (state && scene === 'playing') { previousScroll = state.scroll; update(state, STEP, controls, environmentHit); processEvents(); } } accumulator = 0; renderAlpha = 1; renderDirty = true; refreshHUD(); requestFrame(); },
};
document.body.dataset.ready = 'true';
requestFrame();
