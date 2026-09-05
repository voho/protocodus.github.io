import { BUILDINGS, UNITS, createGame, updateGame, placeBuilding, canPlace, trainUnit, issueOrder, stopUnits, powerStats, getEntity } from './sim.js';
import { Renderer, drawIcon } from './render.js';
import { assetsReady, assetStatus } from './assets.js';

const $ = id => document.getElementById(id);
const canvas = $('world');
const compactScreen = matchMedia('(max-width: 680px)');
const renderer = new Renderer(canvas, $('minimap'));
const view = { x: 14, y: 37, zoom: innerWidth <= 680 ? 24 : 38, selected: new Set(), hover: null, placement: null, placementValid: false, drag: null, commandMarker: null, showGrid: false };
let game, launched = false, paused = true, activeTab = 'build', orderMode = null;
let lastTime = performance.now(), accumulator = 0, hudTimer = 0, toastUntil = 0, lastEvent = 0;
let pointer = null, pointerPosition = null, lastPortrait = '', lastQueue = '', lastNotice = '';
let soundEnabled = false, audioContext, nextCombatSound = 0;
const keys = new Set(), groups = new Map();
const buildTypes = ['reactor', 'refinery', 'barracks', 'factory', 'turret'];
const unitTypes = ['rifle', 'scout', 'tank', 'artillery', 'harvester'];
const fmt = value => Math.floor(value).toLocaleString('en-US');
const minutes = time => `${Math.floor(time / 60).toString().padStart(2, '0')}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
const randomSeed = () => `ASH-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5).toUpperCase()}`;
const entityCenter = e => ({ x: e.x + (e.kind === 'building' ? e.size / 2 : 0), y: e.y + (e.kind === 'building' ? e.size / 2 : 0) });
const selectedEntities = () => game.entities.filter(e => e.team === 0 && e.hp > 0 && view.selected.has(e.id));
const selectedUnits = () => selectedEntities().filter(e => e.kind === 'unit');
const busy = () => !launched || paused || game.status !== 'playing';

function playSound(kind = 'confirm') {
  if (!soundEnabled) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const now = audioContext.currentTime;
    const frequencies = { confirm: 480, select: 340, error: 130, build: 640, combat: 85 };
    oscillator.type = kind === 'combat' ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(frequencies[kind] || 480, now);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'error' ? 75 : kind === 'combat' ? 32 : (frequencies[kind] || 480) * 1.5, now + .10);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(kind === 'combat' ? .016 : .035, now + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .16);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(now); oscillator.stop(now + .17);
  } catch { soundEnabled = false; updateSoundButton(); }
}

function notify(text, warning = false) {
  $('notifications').textContent = text;
  $('notifications').className = `show${warning ? ' warning' : ''}`;
  toastUntil = performance.now() + 4300;
  if (warning) playSound('error');
}

function reset(seed, difficulty) {
  game = createGame(seed, difficulty);
  view.selected.clear(); groups.clear(); keys.clear();
  view.placement = null; view.drag = null; view.hover = null; view.commandMarker = null;
  orderMode = null; pointer = null; pointerPosition = null; accumulator = 0; lastEvent = game.events.length;
  lastPortrait = ''; lastQueue = null; lastNotice = ''; view.showGrid = false;
  $('seed-label').textContent = `SECTOR ${seed}`;
  $('sector-label').textContent = seed;
  setConsole(!compactScreen.matches && !matchMedia('(pointer: coarse)').matches);
  centerBase();
  setTab('build'); updateHUD();
}

function centerBase() {
  const core = game.entities.find(e => e.team === 0 && e.type === 'core' && e.hp > 0);
  if (core) { const c = entityCenter(core); view.x = c.x + 3; view.y = c.y - 1; }
  clampCamera();
}

function clampCamera() {
  const halfWidth = Math.min(game.width / 2, renderer.width / view.zoom / 2);
  const halfHeight = Math.min(game.height / 2, renderer.height / view.zoom / 2);
  view.x = Math.max(halfWidth, Math.min(game.width - halfWidth, view.x));
  view.y = Math.max(halfHeight, Math.min(game.height - halfHeight, view.y));
}

function setConsole(open) {
  $('command-console').hidden = !open;
  $('command-toggle').setAttribute('aria-expanded', String(open));
  document.body.dataset.commands = String(open);
  if (!open && $('command-console').contains(document.activeElement)) $('command-toggle').focus({ preventScroll: true });
}

function setTab(tab) {
  activeTab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    button.tabIndex = button.dataset.tab === tab ? 0 : -1;
  }
  $('catalog').setAttribute('aria-labelledby', `${tab}-tab`);
  $('catalog-tip').textContent = tab === 'build' ? 'Build within your base perimeter.' : 'Recruit into an available production queue.';
  $('catalog').replaceChildren();
  const defs = tab === 'build' ? BUILDINGS : UNITS;
  for (const type of tab === 'build' ? buildTypes : unitTypes) {
    const def = defs[type], button = document.createElement('button');
    button.className = 'build-card'; button.dataset.type = type;
    button.setAttribute('aria-label', `${tab === 'build' ? 'Construct' : 'Recruit'} ${def.name}, ${def.cost} minerals`);
    const icon = document.createElement('canvas'); icon.width = 128; icon.height = 112; icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'card-name'; name.textContent = def.name;
    const cost = document.createElement('span'); cost.className = 'card-price'; cost.textContent = `◈ ${def.cost}`;
    const meta = document.createElement('span'); meta.className = 'card-meta'; meta.textContent = `${def.buildTime || def.trainTime}s`;
    button.append(icon, name, cost, meta);
    button.addEventListener('click', event => chooseProduction(type, event.pointerType === 'touch'));
    button.setAttribute('aria-describedby', 'catalog-tip');
    button.addEventListener('mouseenter', () => { $('catalog-tip').textContent = `${def.description || def.name}${button.dataset.reason ? ` · ${button.dataset.reason}` : ''}`; });
    button.addEventListener('focus', () => { $('catalog-tip').textContent = `${def.description || def.name}${button.dataset.reason ? ` · ${button.dataset.reason}` : ''}`; });
    $('catalog').append(button); drawIcon(icon, type, 0);
  }
  updateCatalog();
}

function updateCatalog() {
  const own = game.entities.filter(e => e.team === 0 && e.kind === 'building' && e.hp > 0 && e.progress >= 1);
  for (const button of $('catalog').children) {
    const type = button.dataset.type, def = (activeTab === 'build' ? BUILDINGS : UNITS)[type];
    const missing = (def.requires || []).filter(type => !own.some(e => e.type === type));
    let reason = missing.length ? `Requires ${missing.map(type => BUILDINGS[type]?.name || type).join(', ')}` : '';
    if (activeTab === 'train' && !own.some(e => e.type === def.producer)) reason ||= `Requires ${BUILDINGS[def.producer]?.name || def.producer}`;
    if (game.teams[0].credits < def.cost) reason ||= 'Insufficient minerals';
    button.dataset.reason = reason;
    button.setAttribute('aria-label', `${activeTab === 'build' ? 'Construct' : 'Recruit'} ${def.name}, ${def.cost} minerals${reason ? `, ${reason}` : ''}`);
    button.disabled = !launched || paused || game.status !== 'playing' || Boolean(reason);
    button.title = [`${def.name} · ${def.cost} minerals · ${def.buildTime || def.trainTime}s`, def.description, reason].filter(Boolean).join(' · ');
    button.classList.toggle('active', view.placement === type);
  }
}

function chooseProduction(type, touch = false) {
  if (busy()) return;
  if (activeTab === 'build') {
    view.placement = view.placement === type ? null : type;
    view.showGrid = Boolean(view.placement); orderMode = null;
    setOrderHint(); updateCatalog(); playSound('select');
    if (view.placement) {
      if (touch || compactScreen.matches) { setConsole(false); canvas.focus({ preventScroll: true }); }
      notify(`Place ${BUILDINGS[type].name} within your base perimeter.`);
    }
  } else {
    const result = trainUnit(game, 0, type);
    if (result.ok) { notify(`${UNITS[type].name} added to production.`); playSound('build'); }
    else notify(result.reason, true);
    updateHUD();
  }
}

function setOrderHint() {
  $('order-hint').hidden = !view.placement && !orderMode;
  $('order-hint').textContent = view.placement ? `PLACE ${BUILDINGS[view.placement].name.toUpperCase()} · ESC TO CANCEL` : orderMode === 'attackMove' ? 'ATTACK MOVE · SELECT A DESTINATION' : 'MOVE · SELECT A DESTINATION';
  canvas.classList.toggle('ordering', Boolean(view.placement || orderMode));
  $('attack-order').classList.toggle('active', orderMode === 'attackMove');
  $('move-order').classList.toggle('active', orderMode === 'move');
}

function cancelOrder() { view.placement = null; view.showGrid = false; orderMode = null; view.drag = null; setOrderHint(); updateCatalog(); }

function setOrder(type) {
  if (busy() || !selectedUnits().length) return;
  view.placement = null; view.showGrid = false;
  orderMode = orderMode === type ? null : type;
  setOrderHint(); updateCatalog();
}

function isVisible(entity) {
  if (entity.team === 0) return true;
  if (entity.kind === 'building') {
    for (let y = entity.y; y < entity.y + entity.size; y++) for (let x = entity.x; x < entity.x + entity.size; x++) if (game.visible[0][y * game.width + x]) return true;
    return false;
  }
  const c = entityCenter(entity);
  return Boolean(game.visible[0][Math.floor(c.y) * game.width + Math.floor(c.x)]);
}

function entityAt(point) {
  const entities = game.entities.filter(e => e.hp > 0 && isVisible(e));
  // Units get pointer priority when standing in front of a structure.
  return entities.find(e => e.kind === 'unit' && Math.hypot(e.x - point.x, e.y - point.y) < .55)
    || entities.find(e => e.kind === 'building' && point.x >= e.x && point.y >= e.y && point.x <= e.x + e.size && point.y <= e.y + e.size);
}

function selectAt(point, additive = false, touch = false) {
  const hit = entityAt(point);
  if (hit?.team === 0) {
    if (!additive) view.selected.clear();
    if (additive && view.selected.has(hit.id)) view.selected.delete(hit.id); else view.selected.add(hit.id);
    playSound('select'); updateHUD();
  } else if (touch && selectedUnits().length) commandAt(point);
  else if (!additive) { view.selected.clear(); updateHUD(); }
}

function commandAt(point, explicitType) {
  const units = selectedUnits();
  if (!units.length) return;
  const x = Math.max(.5, Math.min(game.width - .5, point.x)), y = Math.max(.5, Math.min(game.height - .5, point.y));
  const hit = entityAt({ x, y });
  const index = Math.floor(y) * game.width + Math.floor(x);
  let type = explicitType || 'move';
  if (!explicitType) {
    if (hit && hit.team !== 0) type = 'attack';
    else if (game.minerals[index] > 0 && game.explored[0][index] && units.some(e => e.type === 'harvester')) type = 'harvest';
  }
  if (type === 'harvest') {
    issueOrder(game, units.filter(e => e.type === 'harvester').map(e => e.id), { type, x, y });
    issueOrder(game, units.filter(e => e.type !== 'harvester').map(e => e.id), { type: 'move', x, y });
  } else issueOrder(game, units.map(e => e.id), { type, x, y, targetId: type === 'attack' ? hit.id : undefined });
  view.commandMarker = { x, y, time: performance.now() / 1000, type };
  orderMode = null; setOrderHint(); playSound('confirm'); updateHUD();
}

function placeAt(point) {
  if (!view.placement) return;
  const type = view.placement;
  const result = placeBuilding(game, 0, type, Math.floor(point.x), Math.floor(point.y));
  if (!result.ok) { notify(result.reason, true); return; }
  cancelOrder(); notify(`${BUILDINGS[type].name} construction started.`); playSound('build'); updateHUD();
}

function updateHUD() {
  $('credits').textContent = fmt(game.teams[0].credits);
  const power = powerStats(game, 0);
  $('power').textContent = `${power.supply} / ${power.demand}`;
  $('power-resource').classList.toggle('low-power', power.supply < power.demand);
  $('power-resource').title = `Supply ${power.supply} / demand ${power.demand}${power.ratio < 1 ? '. Low power slows production.' : ''}`;
  $('army').textContent = game.entities.filter(e => e.team === 0 && e.kind === 'unit' && e.hp > 0).length;
  $('mission-time').textContent = minutes(game.time);
  for (const id of view.selected) if (!getEntity(game, id) || getEntity(game, id).hp <= 0) view.selected.delete(id);
  const selection = selectedEntities(), units = selection.filter(e => e.kind === 'unit');
  const first = selection[0];
  $('selection-panel').hidden = !first;
  document.body.dataset.selection = String(Boolean(first));
  $('selection-label').textContent = first ? selection.length > 1 ? 'BATTLE GROUP' : first.kind === 'building' ? 'STRUCTURE' : 'UNIT' : 'COMMAND NETWORK';
  $('selection-name').textContent = first ? selection.length > 1 ? `${selection.length} units selected` : (BUILDINGS[first.type] || UNITS[first.type]).name : 'Expedition standing by';
  let detail = 'Select a unit or structure to issue orders.';
  if (first) {
    if (selection.length > 1) {
      const counts = new Map();
      selection.forEach(e => counts.set(e.type, (counts.get(e.type) || 0) + 1));
      const exploring = units.filter(e => e.order?.type === 'explore').length;
      detail = `${exploring ? `${exploring} auto-exploring · ` : ''}${[...counts].map(([type, n]) => `${n} ${(UNITS[type] || BUILDINGS[type]).name}`).join(' · ')}`;
    } else if (first.kind === 'building') detail = first.progress < 1 ? `Under construction · ${Math.floor(first.progress * 100)}%` : `${Math.ceil(first.hp)} / ${first.maxHp} integrity · ${first.haulerPending ? 'Included hauler awaiting deployment' : (first.queue || []).length ? 'Production active' : 'Operational'}`;
    else if (first.type === 'harvester') detail = `Cargo ${Math.floor(first.cargo || 0)} · ${first.order?.type === 'explore' ? 'Auto-exploring' : first.order?.type === 'move' ? 'Relocating · auto-harvest next' : first.harvestPhase === 'return' ? 'Returning cargo' : 'Auto-harvesting'}`;
    else detail = `${Math.ceil(first.hp)} / ${first.maxHp} integrity · ${first.order?.type === 'explore' ? `Auto-exploring${first.targetId ? ' · Engaging' : ''}` : first.order?.type === 'move' ? 'Moving' : first.targetId || first.order?.type === 'attack' ? 'Engaging' : first.order?.type === 'attackMove' ? 'Advancing' : 'Guarding'}`;
  }
  $('selection-detail').textContent = detail;
  $('selected-count').textContent = first ? `${selection.length}`.padStart(2, '0') : '07';
  $('selection-health').hidden = !first;
  if (first) $('selection-health').firstElementChild.style.width = `${Math.max(0, first.hp / first.maxHp * 100)}%`;
  const portraitKey = first?.type || 'core';
  if (portraitKey !== lastPortrait) { drawIcon($('portrait'), portraitKey, 0); lastPortrait = portraitKey; }
  for (const id of ['move-order', 'attack-order', 'explore-order', 'stop-order']) $(id).disabled = busy() || !units.length;
  const exploring = units.filter(e => e.order?.type === 'explore').length;
  $('explore-order').setAttribute('aria-pressed', exploring ? exploring === units.length ? 'true' : 'mixed' : 'false');
  $('explore-order').classList.toggle('active', exploring > 0);
  $('select-army').disabled = busy();
  const queue = [];
  for (const e of game.entities) if (e.team === 0 && e.kind === 'building' && e.hp > 0) {
    if (e.progress < 1) queue.push({ name: BUILDINGS[e.type].name, progress: e.progress, label: 'BUILD' });
    for (const item of e.queue || []) queue.push({ name: UNITS[item.type].name, progress: item.progress || 0, label: 'TRAIN' });
  }
  $('queue-count').textContent = String(queue.length).padStart(2, '0');
  $('pending-count').hidden = !queue.length;
  $('pending-count').textContent = queue.length;
  $('pending-count').setAttribute('aria-label', `${queue.length} in production`);
  const queueKey = queue.map(q => `${q.name}:${Math.floor(q.progress * 100)}`).join('|');
  if (queueKey !== lastQueue) {
    $('queue-list').replaceChildren();
    if (!queue.length) { const p = document.createElement('p'); p.textContent = 'Production idle'; $('queue-list').append(p); }
    for (const item of queue.slice(0, 3)) {
      const row = document.createElement('div'); row.className = 'queue-item'; row.append(document.createTextNode(item.name));
      const percent = document.createElement('span'); percent.textContent = `${Math.floor(item.progress * 100)}%`;
      const bar = document.createElement('i'); bar.style.width = `${Math.floor(item.progress * 100)}%`;
      row.append(percent, bar); $('queue-list').append(row);
    }
    lastQueue = queueKey;
  }
  updateCatalog();
}

function showMenu(finished = false, guide = false) {
  paused = true; keys.clear(); pointer = null; view.drag = null;
  $('menu-title').textContent = finished ? game.status === 'victory' ? 'The frontier is yours.' : 'The line has fallen.' : 'Hold the line.';
  $('menu-description').textContent = finished ? game.status === 'victory' ? 'The Red Foundry command core is down. Your expedition holds the sector.' : 'Your command core was destroyed. Regroup and take another sector.' : 'The battlefield is paused.';
  $('resume').hidden = finished;
  $('match-summary').hidden = !finished;
  if (finished) $('match-summary').textContent = `${minutes(game.time)} IN FIELD  ·  ${game.teams[0].kills || 0} ENEMIES DESTROYED`;
  $('full-guide').open = guide;
  if (!$('menu').open) $('menu').showModal();
  $('pause').textContent = '▶'; $('pause').setAttribute('aria-label', 'Resume game');
  updateHUD();
}

function resume() {
  if (!launched || game.status !== 'playing') return;
  $('menu').close(); paused = false; accumulator = 0;
  $('pause').textContent = 'Ⅱ'; $('pause').setAttribute('aria-label', 'Pause game');
  updateHUD(); canvas.focus({ preventScroll: true });
}

function updateSoundButton() {
  $('sound').setAttribute('aria-pressed', String(soundEnabled));
  $('sound').setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Enable sound');
}

function selectArmy() {
  if (busy()) return;
  view.selected = new Set(game.entities.filter(e => e.team === 0 && e.kind === 'unit' && e.type !== 'harvester' && e.hp > 0).map(e => e.id));
  updateHUD(); playSound('select');
}

function stopSelection() {
  if (busy()) return;
  stopUnits(game, selectedUnits().map(e => e.id)); cancelOrder(); playSound('confirm'); updateHUD();
}

function toggleExplore() {
  const units = selectedUnits();
  if (busy() || !units.length) return;
  const stop = units.every(e => e.order?.type === 'explore');
  if (stop) stopUnits(game, units.map(e => e.id));
  else issueOrder(game, units.map(e => e.id), { type: 'explore' });
  cancelOrder(); playSound('confirm'); updateHUD();
  notify(stop ? 'Auto-explore stopped.' : 'Auto-explore enabled. Units scout the unexplored frontier.');
}

function zoom(amount, point) {
  const before = point ? renderer.screenToWorld(point.x, point.y, view) : null;
  view.zoom = Math.max(16, Math.min(58, view.zoom * amount));
  if (before) { const after = renderer.screenToWorld(point.x, point.y, view); view.x += before.x - after.x; view.y += before.y - after.y; }
  clampCamera();
}

function localPoint(event) {
  const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  if (busy() || pointer) return;
  event.preventDefault(); canvas.focus({ preventScroll: true });
  const point = localPoint(event), world = renderer.screenToWorld(point.x, point.y, view);
  canvas.setPointerCapture(event.pointerId);
  pointer = { id: event.pointerId, button: event.button, touch: event.pointerType === 'touch', start: point, last: point, startWorld: world, shift: event.shiftKey, dragged: false, pan: event.button === 1 || event.pointerType === 'touch' };
  pointerPosition = point;
});
canvas.addEventListener('pointermove', event => {
  const point = localPoint(event); pointerPosition = point;
  view.hover = renderer.screenToWorld(point.x, point.y, view);
  $('coordinates').textContent = `${String(Math.floor(view.hover.x)).padStart(2, '0')} : ${String(Math.floor(view.hover.y)).padStart(2, '0')}`;
  if (!pointer || event.pointerId !== pointer.id || busy()) return;
  if (Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) > 6) pointer.dragged = true;
  if (pointer.dragged) {
    if (pointer.pan) { view.x -= (point.x - pointer.last.x) / view.zoom; view.y -= (point.y - pointer.last.y) / view.zoom; clampCamera(); }
    else if (pointer.button === 0 && !view.placement && !orderMode) view.drag = { x1: pointer.start.x, y1: pointer.start.y, x2: point.x, y2: point.y };
  }
  pointer.last = point;
});
canvas.addEventListener('pointerup', event => {
  if (!pointer || event.pointerId !== pointer.id) return;
  const active = pointer; pointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (busy()) return;
  const point = localPoint(event), world = renderer.screenToWorld(point.x, point.y, view);
  if (active.dragged) {
    if (view.drag && !active.pan) {
      if (!active.shift) view.selected.clear();
      const a = renderer.screenToWorld(view.drag.x1, view.drag.y1, view), b = renderer.screenToWorld(view.drag.x2, view.drag.y2, view);
      for (const e of game.entities) if (e.team === 0 && e.kind === 'unit' && e.hp > 0 && e.x >= Math.min(a.x, b.x) && e.x <= Math.max(a.x, b.x) && e.y >= Math.min(a.y, b.y) && e.y <= Math.max(a.y, b.y)) view.selected.add(e.id);
      playSound('select'); updateHUD();
    }
    view.drag = null; return;
  }
  if (active.button === 2) { if (view.placement || orderMode) cancelOrder(); else commandAt(world); }
  else if (active.button === 0) {
    if (view.placement) placeAt(world);
    else if (orderMode) commandAt(world, orderMode);
    else selectAt(world, active.shift, active.touch);
  }
});
canvas.addEventListener('pointercancel', () => { pointer = null; view.drag = null; });
canvas.addEventListener('pointerleave', () => { if (!pointer) { pointerPosition = null; view.hover = null; } });
canvas.addEventListener('dblclick', event => {
  if (busy()) return;
  const point = localPoint(event), entity = entityAt(renderer.screenToWorld(point.x, point.y, view));
  if (entity?.team === 0 && entity.kind === 'unit') {
    view.selected = new Set(game.entities.filter(e => e.team === 0 && e.type === entity.type && e.hp > 0).map(e => e.id)); updateHUD();
  }
});
canvas.addEventListener('wheel', event => { event.preventDefault(); if (!busy()) zoom(Math.exp(-event.deltaY * .001), localPoint(event)); }, { passive: false });

const minimap = $('minimap');
function navigateMinimap(event) {
  const rect = minimap.getBoundingClientRect();
  const scale = Math.min(rect.width / game.width, rect.height / game.height);
  const ox = (rect.width - game.width * scale) / 2, oy = (rect.height - game.height * scale) / 2;
  view.x = (event.clientX - rect.left - ox) / scale;
  view.y = (event.clientY - rect.top - oy) / scale;
  clampCamera();
}
let mapDragging = false;
minimap.addEventListener('pointerdown', event => { if (busy()) return; event.preventDefault(); mapDragging = true; minimap.setPointerCapture(event.pointerId); navigateMinimap(event); });
minimap.addEventListener('pointermove', event => { if (mapDragging && !busy()) navigateMinimap(event); });
minimap.addEventListener('pointerup', () => { mapDragging = false; });
minimap.addEventListener('pointercancel', () => { mapDragging = false; });
minimap.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); centerBase(); } });

document.addEventListener('keydown', event => {
  if (event.target.matches('input, select, textarea') || !launched) return;
  if (event.target.closest('button') && [' ', 'Enter'].includes(event.key)) return;
  if ($('menu').open) { if (event.key.toLowerCase() === 'p') { event.preventDefault(); resume(); } return; }
  if (game.status !== 'playing') return;
  const key = event.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
  keys.add(key);
  if (event.repeat) return;
  if (key === 'escape') { if (view.placement || orderMode || view.selected.size) { cancelOrder(); view.selected.clear(); updateHUD(); } else if (!$('command-console').hidden) setConsole(false); else showMenu(); }
  else if (key === 'b') { event.preventDefault(); setConsole($('command-console').hidden); }
  else if (key === 'p') showMenu();
  else if (key === 'a') setOrder('attackMove');
  else if (key === 's') stopSelection();
  else if (key === 'x') toggleExplore();
  else if (key === 'e') selectArmy();
  else if (key === ' ') centerBase();
  else if (key === '+' || key === '=') zoom(1.15);
  else if (key === '-') zoom(1 / 1.15);
  else if (/^[1-5]$/.test(key)) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) { groups.set(key, [...view.selected]); notify(`Control group ${key} assigned.`); }
    else if (groups.has(key)) { view.selected = new Set(groups.get(key).filter(id => getEntity(game, id)?.hp > 0)); updateHUD(); }
  }
});
document.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); pointer = null; pointerPosition = null; view.drag = null; if (launched && !paused && game.status === 'playing') showMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && launched && !paused && game.status === 'playing') showMenu(); });
window.addEventListener('resize', () => { renderer.resize(); if (game) clampCamera(); });

compactScreen.addEventListener('change', event => { if (event.matches) setConsole(false); });
$('command-toggle').addEventListener('click', () => setConsole($('command-console').hidden));
$('command-close').addEventListener('click', () => setConsole(false));
document.querySelector('.console-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const tab = event.key === 'Home' ? 'build' : event.key === 'End' ? 'train' : activeTab === 'build' ? 'train' : 'build';
  setTab(tab); $(`${tab}-tab`).focus();
});
$('build-tab').addEventListener('click', () => setTab('build'));
$('train-tab').addEventListener('click', () => setTab('train'));
$('attack-order').addEventListener('click', () => setOrder('attackMove'));
$('move-order').addEventListener('click', () => setOrder('move'));
$('stop-order').addEventListener('click', stopSelection);
$('explore-order').addEventListener('click', toggleExplore);
$('select-army').addEventListener('click', selectArmy);
$('home').addEventListener('click', centerBase);
$('zoom-in').addEventListener('click', () => zoom(1.18));
$('zoom-out').addEventListener('click', () => zoom(1 / 1.18));
$('pause').addEventListener('click', () => { if (launched) paused ? resume() : showMenu(); });
$('help').addEventListener('click', () => { if (launched) showMenu(game.status !== 'playing', true); });
$('sound').addEventListener('click', () => { soundEnabled = !soundEnabled; updateSoundButton(); playSound('select'); });
$('resume').addEventListener('click', resume);
$('menu').addEventListener('cancel', event => { event.preventDefault(); if (game.status === 'playing') resume(); });
$('briefing').addEventListener('cancel', event => event.preventDefault());
$('new-game').addEventListener('click', () => {
  $('menu').close(); launched = false; paused = true; cancelOrder();
  $('seed').value = randomSeed(); reset($('seed').value, $('difficulty').value);
  $('briefing').showModal(); $('deploy').focus();
});
$('random-seed').addEventListener('click', () => { $('seed').value = randomSeed(); reset($('seed').value, $('difficulty').value); });
$('launch-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!assetStatus.ready) return;
  const seed = $('seed').value.trim() || randomSeed(); $('seed').value = seed;
  reset(seed, $('difficulty').value); launched = true; paused = false;
  $('briefing').close(); $('pause').textContent = 'Ⅱ'; $('pause').setAttribute('aria-label', 'Pause game');
  canvas.focus({ preventScroll: true }); updateHUD(); playSound('confirm');
  notify('Expedition deployed. Build a barracks and recruit your first squad.');
});

function frame(now) {
  const elapsed = Math.min((now - lastTime) / 1000, .2); lastTime = now;
  if (!busy()) {
    accumulator += elapsed;
    while (accumulator >= .05) {
      updateGame(game, .05); accumulator -= .05;
      if (game.status !== 'playing') { showMenu(true); accumulator = 0; break; }
    }
    const panSpeed = 400 / view.zoom * elapsed;
    if (keys.has('arrowleft')) view.x -= panSpeed;
    if (keys.has('arrowright')) view.x += panSpeed;
    if (keys.has('arrowup')) view.y -= panSpeed;
    if (keys.has('arrowdown')) view.y += panSpeed;
    // Edge pan only during a drag selection; normal pointer movement keeps the view still.
    if (pointer && !pointer.pan && pointer.dragged && pointerPosition) {
      if (pointerPosition.x < 18) view.x -= panSpeed;
      if (pointerPosition.x > renderer.width - 18) view.x += panSpeed;
      if (pointerPosition.y < 18) view.y -= panSpeed;
      if (pointerPosition.y > renderer.height - 18) view.y += panSpeed;
    }
    clampCamera();
    if (game.events.length < lastEvent) lastEvent = 0;
    for (let i = lastEvent; i < game.events.length; i++) {
      const event = game.events[i];
      if ((event.team === 0 || event.team === undefined) && event.text !== lastNotice) { notify(event.text, /attack|destroyed|low power/i.test(event.text)); lastNotice = event.text; }
    }
    lastEvent = game.events.length;
    if (soundEnabled && now > nextCombatSound && game.effects.some(e => e.type === 'shot' && game.visible[0][Math.floor(e.y) * game.width + Math.floor(e.x)])) { playSound('combat'); nextCombatSound = now + 200; }
  }
  if (pointerPosition && !busy()) view.hover = renderer.screenToWorld(pointerPosition.x, pointerPosition.y, view);
  if (view.placement && view.hover) view.placementValid = canPlace(game, 0, view.placement, Math.floor(view.hover.x), Math.floor(view.hover.y)).ok;
  if (view.commandMarker && now / 1000 - view.commandMarker.time > .85) view.commandMarker = null;
  renderer.draw(game, view);
  if (now - hudTimer > 150) {
    updateHUD(); hudTimer = now;
    if (!assetStatus.ready && !assetStatus.errors.length) $('asset-status').textContent = `Loading battlefield ${assetStatus.loaded}/${assetStatus.total}`;
  }
  if (toastUntil && now > toastUntil) { $('notifications').className = ''; toastUntil = 0; }
  requestAnimationFrame(frame);
}

$('seed').value = randomSeed();
renderer.resize();
reset($('seed').value, 'normal');
$('briefing').showModal();
assetsReady.then(() => {
  if (!assetStatus.ready) {
    $('asset-status').textContent = 'Battlefield assets could not load. Reload to retry.';
    return;
  }
  $('asset-status').textContent = 'UPLINK READY';
  $('deploy').disabled = false;
  renderer.terrainSource = null;
  setTab(activeTab); lastPortrait = ''; updateHUD();
  $('deploy').focus();
});
requestAnimationFrame(frame);

// Live state handles for reproducible browser playtests and performance inspection.
window.ashline = { get state() { return game; }, view, renderer, assets: assetStatus, get paused() { return paused; } };
