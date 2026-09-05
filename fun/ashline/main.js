import { BUILDINGS, UNITS, createGame, updateGame, placeBuilding, canPlace, trainUnit, setRallyPoint, issueOrder, stopUnits, powerStats, getEntity, unitRank, unitStats } from './sim.js';
import { Renderer, drawIcon } from './render.js';
import { assetsReady, assetStatus } from './assets.js';
import { createAudio } from './audio.js';
import { saveGame, loadGame, getSaveInfo } from './save.js';

const $ = id => document.getElementById(id);
const canvas = $('world');
const compactScreen = matchMedia('(max-width: 680px)');
const renderer = new Renderer(canvas, $('minimap'));
const view = { x: 14, y: 37, zoom: innerWidth <= 680 ? 24 : 38, selected: new Set(), hover: null, placement: null, placementValid: false, drag: null, commandMarker: null, showGrid: false };
let game, launched = false, paused = true, activeTab = 'build', orderMode = null;
let lastTime = performance.now(), accumulator = 0, hudTimer = 0, toastUntil = 0, lastEvent = 0;
let pointer = null, pointerPosition = null, lastPortrait = '', lastQueue = '', lastNotice = '';
const audio = createAudio();
audio.setPaused(true);
let heardEffects = new WeakSet();
const keys = new Set(), groups = new Map();
const buildTypes = ['reactor', 'refinery', 'barracks', 'factory', 'turret', 'rocketTower'];
const unitTypes = ['rifle', 'rocket', 'scout', 'tank', 'artillery', 'harvester'];
const fmt = value => Math.floor(value).toLocaleString('en-US');
const minutes = time => `${Math.floor(time / 60).toString().padStart(2, '0')}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
const randomSeed = () => `ASH-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5).toUpperCase()}`;
const entityCenter = e => ({ x: e.x + (e.kind === 'building' ? e.size / 2 : 0), y: e.y + (e.kind === 'building' ? e.size / 2 : 0) });
const selectedEntities = () => game.entities.filter(e => e.team === 0 && e.hp > 0 && view.selected.has(e.id));
const selectedUnits = () => selectedEntities().filter(e => e.kind === 'unit');
const selectedProducers = () => selectedEntities().filter(e => e.kind === 'building' && ['barracks', 'factory', 'refinery'].includes(e.type));
const chosenProducer = type => {
  const producers = selectedProducers().filter(e => e.type === UNITS[type].producer);
  return producers.length === 1 ? producers[0] : null;
};
const busy = () => !launched || paused || game.status !== 'playing';

function playSound(kind = 'confirm') {
  audio.play(kind);
}

function notify(text, warning = false) {
  $('notifications').textContent = text;
  $('notifications').className = `show${warning ? ' warning' : ''}`;
  toastUntil = performance.now() + 4300;
  if (warning) playSound('error');
}

function reset(seed, difficulty, restored) {
  game = restored?.game || createGame(seed, difficulty);
  view.selected.clear(); groups.clear(); keys.clear();
  view.placement = null; view.drag = null; view.hover = null; view.commandMarker = null;
  orderMode = null; pointer = null; pointerPosition = null; accumulator = 0; lastEvent = game.events.length;
  lastPortrait = ''; lastQueue = null; lastNotice = ''; view.showGrid = false;
  heardEffects = new WeakSet(game.effects);
  renderer.terrainSource = null;
  if (restored) {
    renderer.createTerrain(game);
    renderer.rememberedBuildings = new Map(restored.rememberedBuildings.map(e => [e.id, e]));
    renderer.knownOre = restored.knownOre;
  }
  $('seed-label').textContent = `SECTOR ${seed}`;
  $('sector-label').textContent = seed;
  setConsole(!compactScreen.matches && !matchMedia('(pointer: coarse)').matches);
  centerBase();
  if (restored?.view) { Object.assign(view, restored.view); clampCamera(); }
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
    const count = document.createElement('span'); count.className = 'card-queue-count'; count.hidden = true;
    const production = document.createElement('span'); production.className = 'card-production'; production.hidden = true;
    button.append(icon, name, cost, meta, count, production);
    button.addEventListener('click', event => chooseProduction(type, event.pointerType === 'touch'));
    button.setAttribute('aria-describedby', 'catalog-tip');
    button.addEventListener('mouseenter', () => { $('catalog-tip').textContent = `${def.description || def.name}${button.dataset.reason ? ` · ${button.dataset.reason}` : ''}`; });
    button.addEventListener('focus', () => { $('catalog-tip').textContent = `${def.description || def.name}${button.dataset.reason ? ` · ${button.dataset.reason}` : ''}`; });
    $('catalog').append(button); drawIcon(icon, type, 0);
  }
  updateCatalog();
}

function updateCatalog() {
  const buildings = game.entities.filter(e => e.team === 0 && e.kind === 'building' && e.hp > 0);
  const own = buildings.filter(e => e.progress >= 1);
  const selected = selectedProducers();
  $('production-target').textContent = activeTab === 'build' ? 'BUILD WITHIN YOUR BASE' : selected.length === 1 ? `COMPATIBLE UNITS → ${BUILDINGS[selected[0].type].name.toUpperCase()} #${selected[0].id} · OTHERS AUTO-ASSIGN` : 'AUTOMATIC FACTORY ASSIGNMENT';
  for (const button of $('catalog').children) {
    const type = button.dataset.type, def = (activeTab === 'build' ? BUILDINGS : UNITS)[type];
    const missing = (def.requires || []).filter(type => !own.some(e => e.type === type));
    let reason = missing.length ? `Requires ${missing.map(type => BUILDINGS[type]?.name || type).join(', ')}` : '';
    if (activeTab === 'train' && !own.some(e => e.type === def.producer)) reason ||= `Requires ${BUILDINGS[def.producer]?.name || def.producer}`;
    const producer = activeTab === 'train' ? chosenProducer(type) : null;
    if (producer?.progress < 1) reason ||= 'Selected producer is under construction';
    if (activeTab === 'train' && (producer ? (producer.queue || []).length >= 6 : own.filter(e => e.type === def.producer).every(e => (e.queue || []).length >= 6))) reason ||= 'Production queues full';
    if (game.teams[0].credits < def.cost) reason ||= 'Insufficient minerals';
    button.dataset.reason = reason;
    button.setAttribute('aria-label', `${activeTab === 'build' ? 'Construct' : 'Recruit'} ${def.name}, ${def.cost} minerals${reason ? `, ${reason}` : ''}`);
    button.disabled = !launched || paused || game.status !== 'playing' || Boolean(reason);
    button.title = [`${def.name} · ${def.cost} minerals · ${def.buildTime || def.trainTime}s`, def.description, reason].filter(Boolean).join(' · ');
    button.classList.toggle('active', view.placement === type);
    const queued = activeTab === 'build' ? buildings.filter(e => e.type === type && e.progress < 1).map(e => ({ producer: e, progress: e.progress, active: true })) : buildings.flatMap(e => (e.queue || []).flatMap((item, i) => item.type === type ? [{ producer: e, progress: item.progress || 0, active: i === 0 }] : []));
    const active = queued.filter(item => item.active);
    const count = button.querySelector('.card-queue-count'), progress = button.querySelector('.card-production');
    count.hidden = progress.hidden = !queued.length;
    count.textContent = queued.length;
    count.setAttribute('aria-label', `${queued.length} queued`);
    const progressKey = `${queued.length}:${active.map(item => `${item.producer.id}:${Math.floor(item.progress * 100)}`).join(',')}`;
    if (progress.dataset.key !== progressKey) {
      progress.dataset.key = progressKey; progress.replaceChildren();
      const label = document.createElement('span'); label.textContent = active.length ? `${active.length} ${activeTab === 'build' ? 'building' : 'training'} · ${active.map(item => `${Math.floor(item.progress * 100)}%`).join(' / ')}` : 'Waiting';
      const bars = document.createElement('span'); bars.className = 'card-progress-bars';
      for (const item of active) {
        const bar = document.createElement('span'), fill = document.createElement('i');
        bar.title = `${BUILDINGS[item.producer.type].name} #${item.producer.id}: ${Math.floor(item.progress * 100)}%`;
        bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', `${def.name} at ${BUILDINGS[item.producer.type].name} #${item.producer.id}`);
        bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.floor(item.progress * 100)));
        fill.style.width = `${item.progress * 100}%`; bar.append(fill); bars.append(bar);
      }
      progress.append(label, bars);
    }
    if (queued.length) button.setAttribute('aria-label', `${button.getAttribute('aria-label')}, ${queued.length} queued, ${progress.textContent}`);
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
    const result = trainUnit(game, 0, type, chosenProducer(type)?.id);
    if (result.ok) { notify(`${UNITS[type].name} added to production.`); playSound('build'); }
    else notify(result.reason, true);
    updateHUD();
  }
}

function setOrderHint() {
  $('order-hint').hidden = !view.placement && !orderMode;
  $('order-hint').textContent = view.placement ? `PLACE ${BUILDINGS[view.placement].name.toUpperCase()} · ESC TO CANCEL` : orderMode === 'rally' ? 'RALLY POINT · SELECT A DESTINATION' : orderMode === 'attackMove' ? 'ATTACK MOVE · SELECT A DESTINATION' : 'MOVE · SELECT A DESTINATION';
  canvas.classList.toggle('ordering', Boolean(view.placement || orderMode));
  $('attack-order').classList.toggle('active', orderMode === 'attackMove');
  $('move-order').classList.toggle('active', orderMode === 'move');
  $('rally-order').classList.toggle('active', orderMode === 'rally');
}

function cancelOrder() { view.placement = null; view.showGrid = false; orderMode = null; view.drag = null; setOrderHint(); updateCatalog(); }

function setOrder(type) {
  if (busy() || !(type === 'rally' ? selectedProducers() : selectedUnits()).length) return;
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
  } else if (touch && (selectedUnits().length || selectedProducers().length)) commandAt(point);
  else if (!additive) { view.selected.clear(); updateHUD(); }
}

function commandAt(point, explicitType) {
  const units = selectedUnits();
  const x = Math.max(.5, Math.min(game.width - .5, point.x)), y = Math.max(.5, Math.min(game.height - .5, point.y));
  const producers = selectedProducers();
  if (explicitType === 'rally' || (!units.length && producers.length)) {
    const result = setRallyPoint(game, 0, producers.map(e => e.id), { x, y });
    if (!result.ok) { notify(result.reason, true); return; }
    view.commandMarker = { x, y, time: performance.now() / 1000, type: 'rally' };
    orderMode = null; setOrderHint(); updateHUD(); playSound('order');
    notify(`Rally point set for ${producers.length === 1 ? BUILDINGS[producers[0].type].name : `${producers.length} producers`}.`);
    return;
  }
  if (!units.length) return;
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
  let selection = selectedEntities();
  if (selection.some(e => e.kind === 'unit' && UNITS[e.type].damage > 0)) {
    for (const e of selection) if (e.type === 'harvester') view.selected.delete(e.id);
    selection = selection.filter(e => e.type !== 'harvester');
  }
  const units = selection.filter(e => e.kind === 'unit');
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
    } else if (first.kind === 'building') {
      const job = first.queue?.[0], producer = ['barracks', 'factory', 'refinery'].includes(first.type);
      const activity = [job ? `${UNITS[job.type].name} ${Math.floor(job.progress * 100)}%` : first.processingAmount > 0 ? 'Processing minerals' : producer ? 'Idle · bay empty' : 'Operational'];
      if (first.processingAmount > 0) activity.push(`${Math.ceil(first.processingAmount)} shards remaining`);
      if (first.haulerPending) activity.push('Included hauler awaiting deployment');
      detail = first.progress < 1 ? `Under construction · ${Math.floor(first.progress * 100)}%` : `${Math.ceil(first.hp)} / ${first.maxHp} integrity · ${activity.join(' · ')}`;
      if (selectedProducers().length) detail += first.rally ? ` · Rally ${Math.floor(first.rally.x)}:${Math.floor(first.rally.y)}` : ' · Set rally with R or right click';
    }
    else if (first.type === 'harvester') {
      const cargo = (first.cargo || 0) * (first.unloadDepotId ? Math.max(0, 1 - (first.unload || 0) / 1.2) : 1);
      detail = `${cargo < 1 ? 'Empty' : cargo >= UNITS.harvester.capacity ? 'Full' : `Cargo ${Math.ceil(cargo)} / ${UNITS.harvester.capacity}`} · ${first.unloadDepotId ? 'Unloading minerals' : first.order?.type === 'explore' ? 'Auto-exploring' : first.order?.type === 'move' ? 'Relocating · auto-harvest next' : first.harvestPhase === 'return' ? 'Returning cargo' : 'Auto-harvesting'}`;
    }
    else detail = `${Math.ceil(first.hp)} / ${first.maxHp} integrity · ${first.order?.type === 'explore' ? `Auto-exploring${first.targetId ? ' · Engaging' : ''}` : first.order?.type === 'move' ? 'Moving' : first.targetId || first.order?.type === 'attack' ? 'Engaging' : first.order?.type === 'attackMove' ? 'Advancing' : 'Guarding'}`;
  }
  $('selection-detail').textContent = detail;
  const rankedUnit = selection.length === 1 && first.kind === 'unit' ? first : null;
  const rankInfo = $('selection-rank'); rankInfo.hidden = !rankedUnit;
  if (rankedUnit) {
    const rank = unitRank(rankedUnit), kills = rankedUnit.kills || 0, stats = unitStats(rankedUnit);
    const next = rank < 3 ? (rank + 1) * 5 : null, bonus = rank * 20;
    rankInfo.dataset.rank = rank; rankInfo.dataset.kills = kills;
    rankInfo.textContent = `Rank ${rank}/3 · ${kills}${next ? `/${next}` : ''} kills · +${bonus}%`;
    const summary = `Rank ${rank} of 3. ${kills} kills. ${next ? `${next - kills} kills to next rank.` : 'Maximum rank.'} +${bonus}% damage, speed and maximum HP. Damage ${Number(stats.damage.toFixed(2))}, speed ${Number(stats.speed.toFixed(2))} tiles/second, maximum HP ${stats.hp}.`;
    rankInfo.title = summary; rankInfo.setAttribute('aria-label', summary);
  } else {
    rankInfo.textContent = ''; rankInfo.removeAttribute('title'); rankInfo.removeAttribute('aria-label');
    delete rankInfo.dataset.rank; delete rankInfo.dataset.kills;
  }
  $('selected-count').textContent = first ? `${selection.length}`.padStart(2, '0') : '07';
  $('selection-health').hidden = selection.length !== 1;
  if (first) $('selection-health').firstElementChild.style.width = `${Math.max(0, first.hp / first.maxHp * 100)}%`;
  const portraitKey = first ? `${first.type}:${Math.floor(first.progress * 10)}:${first.queue?.[0]?.type}:${Math.floor((first.queue?.[0]?.progress || 0) * 10)}:${Math.ceil((first.processingAmount || 0) / 50)}:${Math.ceil((first.cargo || 0) * (first.unloadDepotId ? Math.max(0, 1 - (first.unload || 0) / 1.2) : 1) / 50)}` : 'core';
  if (portraitKey !== lastPortrait) { drawIcon($('portrait'), first?.type || 'core', 0, first); lastPortrait = portraitKey; }
  for (const id of ['move-order', 'attack-order', 'explore-order', 'stop-order']) { $(id).disabled = busy() || !units.length; $(id).hidden = !units.length; }
  $('rally-order').hidden = !selectedProducers().length;
  $('rally-order').disabled = busy() || !selectedProducers().length;
  const exploring = units.filter(e => e.order?.type === 'explore').length;
  $('explore-order').setAttribute('aria-pressed', exploring ? exploring === units.length ? 'true' : 'mixed' : 'false');
  $('explore-order').classList.toggle('active', exploring > 0);
  $('select-army').disabled = busy();
  const queue = []; let queueCount = 0;
  for (const e of game.entities) if (e.team === 0 && e.kind === 'building' && e.hp > 0) {
    if (e.progress < 1) { queue.push({ id: e.id, name: BUILDINGS[e.type].name, progress: e.progress, label: 'CONSTRUCTION' }); queueCount++; }
    if (e.queue?.length) {
      queueCount += e.queue.length;
      queue.push({ id: e.id, name: UNITS[e.queue[0].type].name, progress: e.queue[0].progress || 0, label: `${BUILDINGS[e.type].name} #${e.id}${e.queue.length > 1 ? ` · +${e.queue.length - 1} waiting` : ''}` });
    }
  }
  $('queue-count').textContent = String(queueCount).padStart(2, '0');
  $('pending-count').hidden = !queueCount;
  $('pending-count').textContent = queueCount;
  $('pending-count').setAttribute('aria-label', `${queueCount} in production`);
  const queueKey = queue.map(q => `${q.id}:${q.name}:${q.label}:${Math.floor(q.progress * 100)}`).join('|');
  if (queueKey !== lastQueue) {
    $('queue-list').replaceChildren();
    if (!queue.length) { const p = document.createElement('p'); p.textContent = 'Production idle'; $('queue-list').append(p); }
    for (const item of queue) {
      const row = document.createElement('div'); row.className = 'queue-item';
      const name = document.createElement('b'); name.textContent = item.name;
      const label = document.createElement('small'); label.textContent = item.label; name.append(label); row.append(name);
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
  audio.setPaused(true);
  $('menu-title').textContent = finished ? game.status === 'victory' ? 'The frontier is yours.' : 'The line has fallen.' : 'Hold the line.';
  $('menu-description').textContent = finished ? game.status === 'victory' ? 'The Red Foundry command core is down. Your expedition holds the sector.' : 'Your command core was destroyed. Regroup and take another sector.' : 'The battlefield is paused.';
  $('resume').hidden = finished;
  $('match-summary').hidden = !finished;
  if (finished) $('match-summary').textContent = `${minutes(game.time)} IN FIELD  ·  ${game.teams[0].kills || 0} ENEMIES DESTROYED`;
  $('full-guide').open = guide;
  if (!$('menu').open) $('menu').showModal();
  $('pause').textContent = '▶'; $('pause').setAttribute('aria-label', 'Resume game');
  refreshSaveControls(); updateHUD();
}

function resume() {
  if (!launched || game.status !== 'playing') return;
  $('menu').close(); paused = false; accumulator = 0;
  audio.unlock(); audio.setPaused(false);
  $('pause').textContent = 'Ⅱ'; $('pause').setAttribute('aria-label', 'Pause game');
  updateHUD(); canvas.focus({ preventScroll: true });
}

function updateSoundButton() {
  const { sfxEnabled, musicEnabled } = audio.status;
  $('sound').setAttribute('aria-pressed', String(sfxEnabled));
  $('sound').setAttribute('aria-label', sfxEnabled ? 'Mute sound effects' : 'Enable sound effects');
  $('sfx-toggle').setAttribute('aria-pressed', String(sfxEnabled));
  $('sfx-toggle').textContent = `EFFECTS ${sfxEnabled ? 'ON' : 'OFF'}`;
  $('music-toggle').setAttribute('aria-pressed', String(musicEnabled));
  $('music-toggle').textContent = `MUSIC ${musicEnabled ? 'ON' : 'OFF'}`;
}

function refreshSaveControls(message) {
  const info = getSaveInfo();
  const description = info.ok ? `${info.seed} · ${minutes(info.time)} · ${new Date(info.savedAt).toLocaleString()}` : info.reason;
  $('save-status').textContent = message || description;
  $('saved-operation').textContent = description;
  $('load-game').disabled = $('load-saved').disabled = !assetStatus.ready || !info.ok;
  $('save-game').disabled = !launched || game.status !== 'playing';
}

function saveOperation() {
  const result = saveGame(game, { ...view, rememberedBuildings: [...renderer.rememberedBuildings.values()], knownOre: renderer.knownOre });
  refreshSaveControls(result.ok ? 'Operation saved in this browser.' : result.reason);
}

function loadOperation() {
  if (!assetStatus.ready) return;
  const result = loadGame();
  if (!result.ok) { refreshSaveControls(result.reason); return; }
  paused = true; launched = true;
  $('seed').value = result.game.seed; $('difficulty').value = result.game.difficulty;
  reset(result.game.seed, result.game.difficulty, result);
  $('briefing').close(); audio.unlock(); showMenu(game.status !== 'playing');
  $('menu-description').textContent = 'Operation restored. Resume when ready.';
  refreshSaveControls('Loaded the saved operation.');
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
    const topLeft = renderer.screenToWorld(0, 0, view), bottomRight = renderer.screenToWorld(renderer.width, renderer.height, view);
    view.selected = new Set(game.entities.filter(e => e.team === 0 && e.kind === 'unit' && e.type === entity.type && e.hp > 0
      && e.x >= topLeft.x && e.x <= bottomRight.x && e.y >= topLeft.y && e.y <= bottomRight.y).map(e => e.id));
    updateHUD();
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
  else if (key === 'r') setOrder('rally');
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
$('rally-order').addEventListener('click', () => setOrder('rally'));
$('stop-order').addEventListener('click', stopSelection);
$('explore-order').addEventListener('click', toggleExplore);
$('select-army').addEventListener('click', selectArmy);
$('home').addEventListener('click', centerBase);
$('zoom-in').addEventListener('click', () => zoom(1.18));
$('zoom-out').addEventListener('click', () => zoom(1 / 1.18));
$('pause').addEventListener('click', () => { if (launched) paused ? resume() : showMenu(); });
$('help').addEventListener('click', () => { if (launched) showMenu(game.status !== 'playing', true); });
function toggleSfx() { audio.unlock(); audio.setSfxEnabled(!audio.status.sfxEnabled); updateSoundButton(); playSound('select'); }
$('sound').addEventListener('click', toggleSfx);
$('sfx-toggle').addEventListener('click', toggleSfx);
$('music-toggle').addEventListener('click', () => { audio.unlock(); audio.setMusicEnabled(!audio.status.musicEnabled); updateSoundButton(); });
$('save-game').addEventListener('click', saveOperation);
$('load-game').addEventListener('click', loadOperation);
$('load-saved').addEventListener('click', loadOperation);
$('resume').addEventListener('click', resume);
$('menu').addEventListener('cancel', event => { event.preventDefault(); if (game.status === 'playing') resume(); });
$('briefing').addEventListener('cancel', event => event.preventDefault());
$('new-game').addEventListener('click', () => {
  $('menu').close(); launched = false; paused = true; cancelOrder();
  audio.setPaused(true);
  $('seed').value = randomSeed(); reset($('seed').value, $('difficulty').value);
  refreshSaveControls(); $('briefing').showModal(); $('deploy').focus();
});
$('random-seed').addEventListener('click', () => { $('seed').value = randomSeed(); reset($('seed').value, $('difficulty').value); });
$('launch-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!assetStatus.ready) return;
  const seed = $('seed').value.trim() || randomSeed(); $('seed').value = seed;
  reset(seed, $('difficulty').value); launched = true; paused = false;
  audio.unlock(); audio.setPaused(false);
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
      if (game.status !== 'playing') { showMenu(true); playSound(game.status); accumulator = 0; break; }
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
      if (event.team !== 0 && event.team !== undefined) continue;
      if (event.text.startsWith('Shard delivery:')) { playSound('delivery'); continue; }
      if (/ online$/.test(event.text)) playSound('buildComplete');
      else if (/ ready$/.test(event.text)) playSound('unitReady');
      if (event.text !== lastNotice) { notify(event.text, /attack|destroyed|low power/i.test(event.text)); lastNotice = event.text; }
    }
    lastEvent = game.events.length;
    for (const effect of game.effects) {
      if (heardEffects.has(effect)) continue;
      heardEffects.add(effect);
      if (!game.visible[0][Math.floor(effect.y) * game.width + Math.floor(effect.x)]) continue;
      if (effect.type === 'shot' || effect.type === 'shell' || effect.type === 'rocket') playSound(effect.weapon || 'rifle');
      else if (effect.type === 'explosion') playSound('explosion');
    }
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
updateSoundButton(); refreshSaveControls();
$('briefing').showModal();
assetsReady.then(() => {
  if (!assetStatus.ready) {
    $('asset-status').textContent = 'Battlefield assets could not load. Reload to retry.';
    return;
  }
  $('asset-status').textContent = 'UPLINK READY';
  $('deploy').disabled = false;
  refreshSaveControls();
  renderer.terrainSource = null;
  setTab(activeTab); lastPortrait = ''; updateHUD();
  $('deploy').focus();
});
requestAnimationFrame(frame);

// Live state handles for reproducible browser playtests and performance inspection.
window.ashline = { get state() { return game; }, view, renderer, assets: assetStatus, get paused() { return paused; }, get audio() { return audio.status; } };
