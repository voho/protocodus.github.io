import { BUILDINGS, UNITS, UNIT_CAP, RESEARCH, BUILDING_UPGRADES, MAP_SIZES, MAP_PROFILES, RACES, buildingRole, unitRole, teamRace, raceBuilding, raceUnit, planWallLine, buildWallLine, terrainCover, researchStatus, startResearch, buildingUpgradeStatus, startBuildingUpgrade, updateGame, placeBuilding, canPlace, trainUnit, setRallyPoint, issueOrder, stopUnits, powerStats, getEntity, unitRank, unitStats, toggleRepair, sellBuilding, salvageValue } from './sim.js';
import { Renderer, drawIcon } from './render.js';
import { startAssets, assetStatus, spriteNativeZoom } from './assets.js';
import { zoomLevels, nearestZoom, steppedZoom, cameraDirection } from './camera.js';
import { createAudio } from './audio.js';
import { saveGame, loadGame, getSaveInfo } from './save.js';
import { nextPaint, generateOperation } from './loading.js';

const $ = id => document.getElementById(id);
const canvas = $('world');
const compactScreen = matchMedia('(max-width: 680px)');
const renderer = new Renderer(canvas, $('minimap'));
const view = { x: 14, y: 37, zoom: innerWidth <= 680 ? 24 : 38, selected: new Set(), hover: null, placement: null, placementValid: false, placementReason: '', drag: null, commandMarker: null, showGrid: false };
let frameRequest = 0;
let game = null, launched = false, paused = true, loading = false, activeTab = 'build', orderMode = null;
let lastTime = performance.now(), accumulator = 0, hudTimer = 0, toastUntil = 0, lastEvent = 0;
let pointer = null, pointerPosition = null, lastPortrait = '', lastQueue = '', lastNotice = '', lowPower = false, pinchDistance = 0;
const touches = new Map();
let edgePointer = null, wheelTravel = 0, lastZoomAt = 0;
let wallPreviewKey = '', wallPreviewAt = 0;
let preferredZoomIndex = compactScreen.matches ? 1 : 2;
const cameraLevels = () => zoomLevels(spriteNativeZoom(renderer.dpr));
const audio = createAudio();
audio.setPaused(true);
let heardEffects = new WeakSet();
const keys = new Set(), groups = new Map();
const buildTypes = ['reactor', 'refinery', 'barracks', 'factory', 'lab', 'capacitor', 'turret', 'rocketTower', 'wall'];
const unitTypes = ['rifle', 'rocket', 'scout', 'tank', 'artillery', 'striker', 'engineer', 'harvester'];
const researchBranches = [
  { name: 'Infantry doctrine', ids: ['infantryWeapons', 'infantryArmor'] },
  { name: 'Armored warfare', ids: ['vehicleWeapons', 'mobility'] },
  { name: 'Grid & systems', ids: ['gridEfficiency', 'advancedBallistics'] },
];
const fmt = value => Math.floor(value).toLocaleString('en-US');
const minutes = time => `${Math.floor(time / 60).toString().padStart(2, '0')}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
const randomSeed = () => `ASH-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 5).toUpperCase()}`;
const entityCenter = e => ({ x: e.x + (e.kind === 'building' ? e.size / 2 : 0), y: e.y + (e.kind === 'building' ? e.size / 2 : 0) });
const selectedEntities = () => game.entities.filter(e => e.team === 0 && e.hp > 0 && view.selected.has(e.id));
const selectedUnits = () => selectedEntities().filter(e => e.kind === 'unit');
const researchText = def => def.description.replaceAll('Pike striker', UNITS[raceUnit(game, 0, 'striker')].name).replace('Rifle and rocket infantry', 'Light and heavy infantry');
const selectedProducers = () => selectedEntities().filter(e => e.kind === 'building' && ['barracks', 'factory', 'refinery'].includes(buildingRole(e)));
const chosenProducer = type => {
  const producers = selectedProducers().filter(e => e.type === UNITS[type].producer);
  return producers.length === 1 ? producers[0] : null;
};
const busy = () => !launched || paused || game.status !== 'playing';
const cardMeta = def => `${def.buildTime || def.trainTime}s` + (def.power < 0 ? ` · ${-def.power}ϟ` : def.power > 0 ? ` · +${def.power}ϟ` : '');

function playSound(kind = 'confirm') {
  audio.play(kind);
}

function notify(text, warning = false, soft = false) {
  // Only low-value simulation chatter defers to a live warning; direct feedback to a click always replaces it.
  if (soft && $('notifications').classList.contains('warning') && performance.now() < toastUntil) return;
  $('notifications').textContent = text;
  $('notifications').className = `show${warning ? ' warning' : ''}`;
  toastUntil = performance.now() + 4300;
  if (warning) playSound('error');
}

async function reset(prepared, restored) {
  game = prepared;
  view.selected.clear(); groups.clear(); keys.clear();
  view.placement = null; view.drag = null; view.hover = null; view.commandMarker = null;
  view.wallStart = null; view.wallPlan = null;
  orderMode = null; pointer = null; pointerPosition = null; accumulator = 0; lastEvent = game.events.length;
  lastPortrait = ''; lastQueue = null; lastNotice = ''; view.showGrid = false; lowPower = false; touches.clear();
  delete $('building-upgrades').dataset.entity;
  heardEffects = new WeakSet(game.effects);
  renderer.terrainSource = null;
  await renderer.prepareTerrain(game, ({ value, label }) => updateLoading(40 + value * 58, label));
  if (restored) {
    renderer.rememberedBuildings = new Map(restored.rememberedBuildings.map(e => [e.id, e]));
    renderer.knownOre = restored.knownOre;
    // Mineral material is immutable; only previously explored deposits have known colors.
    renderer.knownMineralTypes = Uint8Array.from(game.mineralTypes, (type, i) => game.explored[0][i] ? type : 0);
  }
  $('seed-label').textContent = `${game.seed} · ${game.width}×${game.height}`;
  $('sector-label').textContent = `${MAP_PROFILES[game.mapProfile]?.name || 'Ash frontier'} / ${game.seed}`;
  setConsole(!compactScreen.matches && !matchMedia('(pointer: coarse)').matches);
  centerBase();
  if (restored?.view) Object.assign(view, restored.view);
  view.zoom = restored?.view?.zoom ? nearestZoom(view.zoom, cameraLevels()) : cameraLevels()[preferredZoomIndex]; clampCamera(); updateZoomLabel();
  setTab('build'); updateHUD();
}

function centerBase() {
  const core = game.entities.find(e => e.team === 0 && buildingRole(e) === 'core' && e.hp > 0);
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
  if (tab !== activeTab && view.placement) { view.placement = null; view.showGrid = false; setOrderHint(); }
  activeTab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    button.tabIndex = button.dataset.tab === tab ? 0 : -1;
  }
  $('catalog').setAttribute('aria-labelledby', `${tab}-tab`);
  $('catalog').dataset.category = tab;
  updateBuildingUpgrades();
  if (tab === 'research') { createResearchCatalog(); updateCatalog(); return; }
  $('catalog-tip').textContent = tab === 'build' ? 'Build within 7 tiles of a finished structure.' : 'Recruit into an available production queue.';
  $('catalog').replaceChildren();
  const defs = tab === 'build' ? BUILDINGS : UNITS;
  for (const type of tab === 'build' ? buildTypes.map(role => raceBuilding(game, 0, role)) : unitTypes.map(role => raceUnit(game, 0, role))) {
    const def = defs[type], button = document.createElement('button');
    button.className = 'build-card'; button.dataset.type = type;
    button.setAttribute('aria-label', `${tab === 'build' ? 'Construct' : 'Recruit'} ${def.name}, ${def.cost} credits`);
    const icon = document.createElement('canvas'); icon.width = 128; icon.height = 112; icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'card-name'; name.textContent = def.name;
    const cost = document.createElement('span'); cost.className = 'card-price'; cost.textContent = `◈ ${def.cost}`;
    const meta = document.createElement('span'); meta.className = 'card-meta'; meta.textContent = cardMeta(def);
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
  if (activeTab === 'research') { updateResearchCatalog(); return; }
  const buildings = game.entities.filter(e => e.team === 0 && e.kind === 'building' && e.hp > 0);
  const own = buildings.filter(e => e.progress >= 1);
  const population = game.entities.filter(e => e.team === 0 && e.kind === 'unit' && e.hp > 0).length + buildings.reduce((n, e) => n + e.queue.length + (e.haulerPending ? 1 : 0), 0);
  const selected = selectedProducers();
  $('production-target').textContent = activeTab === 'build' ? 'Build within 7 tiles of a finished structure' : selected.length === 1 ? `Compatible units → ${BUILDINGS[selected[0].type].name} #${selected[0].id} · others auto-assign` : 'Automatic factory assignment';
  for (const button of $('catalog').children) {
    const type = button.dataset.type, def = (activeTab === 'build' ? BUILDINGS : UNITS)[type];
    const missing = (def.requires || []).filter(type => !own.some(e => buildingRole(e) === buildingRole(type)));
    let reason = missing.length ? `Requires ${missing.map(type => BUILDINGS[type]?.name || type).join(', ')}` : '';
    if (activeTab === 'train' && !own.some(e => e.type === def.producer)) reason ||= `Requires ${BUILDINGS[def.producer]?.name || def.producer}`;
    if (activeTab === 'train' && def.research && !game.teams[0].research?.[def.research]) reason ||= `Research ${RESEARCH[def.research]?.name || def.research}`;
    if (activeTab === 'train' && unitRole(type) === 'striker' && !(chosenProducer(type) ? chosenProducer(type).upgrades?.advancedProduction : own.some(e => buildingRole(e) === 'factory' && e.upgrades?.advancedProduction))) reason ||= 'Requires Advanced assembly bay';
    const producer = activeTab === 'train' ? chosenProducer(type) : null;
    const eligibleProducers = activeTab === 'train' ? own.filter(e => e.type === def.producer && (unitRole(type) !== 'striker' || e.upgrades?.advancedProduction)) : [];
    if (producer?.progress < 1) reason ||= 'Selected producer is under construction';
    if (activeTab === 'train' && (producer ? (producer.queue || []).length >= 6 : eligibleProducers.every(e => (e.queue || []).length >= 6))) reason ||= 'Production queues full';
    if (activeTab === 'train' && population >= UNIT_CAP) reason ||= `Unit limit reached (${UNIT_CAP})`;
    if (game.teams[0].credits < def.cost) reason ||= 'Insufficient credits';
    button.dataset.reason = reason;
    button.querySelector('.card-meta').textContent = reason || cardMeta(def);
    button.setAttribute('aria-label', `${activeTab === 'build' ? 'Construct' : 'Recruit'} ${def.name}, ${def.cost} credits${reason ? `, ${reason}` : ''}`);
    button.disabled = !launched || paused || game.status !== 'playing' || Boolean(reason);
    button.title = [`${def.name} · ${def.cost} credits · ${def.buildTime || def.trainTime}s`, def.description, reason].filter(Boolean).join(' · ');
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

function createResearchCatalog() {
  $('catalog').replaceChildren();
  $('catalog-tip').textContent = 'Each branch unlocks its next project. Upgrades apply to existing and future forces.';
  for (const branch of researchBranches) {
    const section = document.createElement('section'); section.className = 'research-branch';
    const heading = document.createElement('h3'); heading.textContent = branch.name; section.append(heading);
    branch.ids.forEach((id, tier) => {
      const def = RESEARCH[id], button = document.createElement('button');
      button.className = 'research-card'; button.dataset.research = id;
      const badge = document.createElement('span'); badge.className = 'research-tier'; badge.textContent = String(tier + 1).padStart(2, '0'); badge.setAttribute('aria-hidden', 'true');
      const name = document.createElement('b'); name.textContent = def.name;
      const description = document.createElement('span'); description.className = 'research-description'; description.textContent = researchText(def);
      const status = document.createElement('span'); status.className = 'research-state';
      const progress = document.createElement('span'); progress.className = 'research-progress'; progress.hidden = true;
      const fill = document.createElement('i'); progress.append(fill);
      button.append(badge, name, description, status, progress);
      button.addEventListener('click', () => {
        if (busy()) return;
        const lab = selectedEntities().find(e => buildingRole(e) === 'lab' && e.progress >= 1 && !e.research);
        const result = startResearch(game, 0, id, lab?.id);
        if (result.ok) { notify(`${def.name} research started.`); playSound('build'); }
        else notify(result.reason, true);
        updateHUD();
      });
      section.append(button);
    });
    $('catalog').append(section);
  }
}

function updateResearchCatalog() {
  const labs = game.entities.filter(e => e.team === 0 && buildingRole(e) === 'lab' && e.hp > 0 && e.progress >= 1);
  const complete = Object.keys(RESEARCH).filter(id => game.teams[0].research?.[id]).length;
  $('production-target').textContent = `${complete} / ${Object.keys(RESEARCH).length} upgrades · ${labs.length ? `${labs.length} lab${labs.length === 1 ? '' : 's'} online` : `Build ${BUILDINGS[raceBuilding(game, 0, 'lab')].name}`}`;
  for (const button of $('catalog').querySelectorAll('[data-research]')) {
    const id = button.dataset.research, def = RESEARCH[id], status = researchStatus(game, 0, id);
    const lab = labs.find(e => e.research?.id === id), progress = lab?.research?.progress || 0;
    const state = status.completed ? 'complete' : status.queued ? 'active' : status.ok ? 'available' : 'locked';
    button.dataset.state = state;
    button.disabled = busy() || !status.ok;
    const label = status.completed ? '✓ Researched' : status.queued ? `Researching · ${Math.floor(progress * 100)}%` : status.ok ? `◈ ${def.cost} · ${def.time}s` : `${status.reason} · ◈ ${def.cost}`;
    button.querySelector('.research-state').textContent = label;
    button.querySelector('.research-tier').textContent = status.completed ? '✓' : status.queued ? '…' : (researchBranches.find(b => b.ids.includes(id)).ids.indexOf(id) + 1).toString().padStart(2, '0');
    button.title = `${def.name} · ${def.cost} credits · ${def.time}s. ${researchText(def)}${status.reason ? ` ${status.reason}` : ''}`;
    button.setAttribute('aria-label', `${def.name}. ${researchText(def)} ${label}`);
    const bar = button.querySelector('.research-progress'); bar.hidden = !status.queued;
    bar.firstElementChild.style.width = `${progress * 100}%`;
    if (status.queued) { bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', def.name); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.floor(progress * 100))); }
  }
}

function updateBuildingUpgrades() {
  const selected = selectedEntities(), building = selected.length === 1 && selected[0].kind === 'building' ? selected[0] : null;
  const ids = building ? Object.keys(BUILDING_UPGRADES).filter(id => BUILDING_UPGRADES[id].types.includes(buildingRole(building))) : [];
  $('upgrade-building').hidden = !ids.length;
  $('upgrade-building').disabled = busy();
  const panel = $('building-upgrades'); panel.hidden = activeTab !== 'research' || !ids.length;
  if (panel.hidden) return;
  $('upgrade-target').textContent = `${BUILDINGS[building.type].name} #${building.id}`;
  if (panel.dataset.entity !== `${building.id}:${building.type}`) {
    panel.dataset.entity = `${building.id}:${building.type}`; $('upgrade-list').replaceChildren();
    for (const id of ids) {
      const def = BUILDING_UPGRADES[id], button = document.createElement('button'); button.className = 'upgrade-card'; button.dataset.upgrade = id;
      const name = document.createElement('b'); name.textContent = def.name;
      const status = document.createElement('span'); button.append(name, status);
      button.addEventListener('click', () => {
        if (busy()) return;
        const result = startBuildingUpgrade(game, 0, building.id, id);
        if (result.ok) { notify(`${def.name} upgrade started.`); playSound('build'); } else notify(result.reason, true);
        updateHUD();
      });
      $('upgrade-list').append(button);
    }
  }
  for (const button of $('upgrade-list').children) {
    const id = button.dataset.upgrade, def = BUILDING_UPGRADES[id], status = buildingUpgradeStatus(game, 0, building.id, id);
    const complete = !!building.upgrades?.[id], running = building.upgrade?.id === id;
    const label = complete ? '✓ INSTALLED' : running ? `${Math.floor(building.upgrade.progress * 100)}% · INSTALLING` : status.ok ? `◈ ${def.cost} · ${def.time}s` : status.reason;
    button.disabled = busy() || !status.ok; button.dataset.state = complete ? 'complete' : running ? 'active' : 'available';
    button.lastElementChild.textContent = label; button.title = `${def.description} ${def.cost} credits · ${def.time}s. ${label}`;
    button.setAttribute('aria-label', `${def.name}. ${def.description} ${label}`);
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
      notify(`Place ${BUILDINGS[type].name} within 7 tiles of a finished structure.`);
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
  canvas.classList.toggle('ordering', Boolean(view.placement || orderMode));
  $('attack-order').classList.toggle('active', orderMode === 'attackMove');
  $('move-order').classList.toggle('active', orderMode === 'move');
  $('rally-order').classList.toggle('active', orderMode === 'rally');
  if (view.placement === 'wall') {
    const plan = view.wallPlan;
    $('order-hint-text').textContent = `Wall line · ${plan?.count ?? 1} segments · ◈ ${plan?.cost ?? BUILDINGS.wall.cost}${plan?.reason ? ` · ${plan.reason}` : ' · Drag to build'}`;
    return;
  }
  $('order-hint-text').textContent = view.placement ? `Place ${BUILDINGS[view.placement].name} · ${view.placementReason || 'Click to build'}` : orderMode === 'rally' ? 'Rally point · Select a destination' : orderMode === 'attackMove' ? 'Attack move · Select a destination' : 'Move · Select a destination';
}

function cancelOrder() { view.placement = null; view.placementReason = ''; view.showGrid = false; view.wallStart = null; view.wallPlan = null; orderMode = null; view.drag = null; setOrderHint(); updateCatalog(); }
$('cancel-order').addEventListener('click', () => { cancelOrder(); canvas.focus({preventScroll:true}); });

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
    else if ((game.visible[0][index] ? game.minerals[index] : renderer.knownOre[index]) > 0 && game.explored[0][index] && units.some(e => unitRole(e) === 'harvester')) type = 'harvest';
  }
  if (type === 'harvest') {
    issueOrder(game, units.filter(e => unitRole(e) === 'harvester').map(e => e.id), { type, x, y });
    issueOrder(game, units.filter(e => unitRole(e) !== 'harvester').map(e => e.id), { type: 'move', x, y });
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
  const low = power.ratio < 1;
  // Let a live warning (such as the reactor's destruction) finish before the low-power line replaces it.
  if (low !== lowPower && !(low && performance.now() < toastUntil && $('notifications').classList.contains('warning'))) { lowPower = low; if (low && game.status === 'playing' && !paused) notify(`Low power: defenses offline and production slowed. Build ${BUILDINGS[raceBuilding(game, 0, 'reactor')].name}.`, true); }
  $('power').textContent = `${Math.floor(power.supply)} / ${Math.ceil(power.demand)}`;
  $('power-label').textContent = low ? 'Brownout' : power.usingReserve ? 'Reserve' : 'Power';
  $('power-resource').classList.toggle('low-power', low);
  $('power-resource').classList.toggle('reserve-power', power.usingReserve);
  const powerDetail = low ? `Brownout: ${Math.round(power.ratio * 100)}% power. Production, research, mineral processing and repairs slow; defenses are offline.` : power.usingReserve ? `Reserve power: ${Math.ceil(power.reserveSeconds)} seconds remaining. Build a reactor before storage runs out.` : `Grid stable. ${Math.round(power.supply - power.demand)} power available.`;
  $('power-resource').title = powerDetail;
  $('grid-summary').textContent = low ? 'Brownout' : power.usingReserve ? 'Reserve active' : 'Grid stable';
  $('grid-state').dataset.state = power.status;
  $('grid-rate').textContent = `${Math.round(power.ratio * 100)}%`;
  $('grid-output').style.width = `${power.ratio * 100}%`;
  $('grid-detail').textContent = low ? 'Defenses offline · industry slowed' : power.usingReserve ? `${Math.ceil(power.reserveSeconds)}s of reserve · restore supply` : 'All systems operational';
  $('reserve-meter').hidden = !power.reserveCapacity;
  $('reserve-fill').style.width = `${power.reserveCapacity ? power.reserve / power.reserveCapacity * 100 : 0}%`;
  $('reserve-label').textContent = `Storage ${Math.round(power.reserve || 0)} / ${power.reserveCapacity || 0}`;
  $('grid-state').title = powerDetail;
  const deployed = game.entities.filter(e => e.team === 0 && e.kind === 'unit' && e.hp > 0).length;
  const reserved = game.entities.filter(e => e.team === 0 && e.kind === 'building' && e.hp > 0).reduce((n, e) => n + e.queue.length + (e.haulerPending ? 1 : 0), 0);
  $('army').textContent = deployed;
  $('army').closest('.resource').title = `${deployed} deployed · ${reserved} in production · ${UNIT_CAP} units per side`;
  $('mission-time').textContent = minutes(game.time);
  for (const id of view.selected) if (!getEntity(game, id) || getEntity(game, id).hp <= 0) view.selected.delete(id);
  let selection = selectedEntities();
  if (selection.some(e => e.kind === 'unit' && UNITS[e.type].damage > 0)) {
    for (const e of selection) if (unitRole(e) === 'harvester') view.selected.delete(e.id);
    selection = selection.filter(e => unitRole(e) !== 'harvester');
  }
  const units = selection.filter(e => e.kind === 'unit');
  const first = selection[0];
  const panel = $('selection-panel');
  if (!first && !panel.hidden && panel.contains(document.activeElement)) canvas.focus({ preventScroll: true });
  panel.hidden = !first;
  $('deselect').hidden = !view.selected.size;
  document.body.dataset.selection = String(Boolean(first));
  $('selection-label').textContent = first ? selection.length > 1 ? 'Battle group' : first.kind === 'building' ? 'Structure' : 'Unit' : 'Command network';
  $('selection-name').textContent = first ? selection.length > 1 ? `${selection.length} units selected` : (BUILDINGS[first.type] || UNITS[first.type]).name : 'Expedition standing by';
  let detail = 'Select a unit or structure to issue orders.';
  if (first) {
    if (selection.length > 1) {
      const counts = new Map();
      selection.forEach(e => counts.set(e.type, (counts.get(e.type) || 0) + 1));
      const exploring = units.filter(e => e.order?.type === 'explore').length;
      detail = `${exploring ? `${exploring} auto-exploring · ` : ''}${[...counts].map(([type, n]) => `${n} ${(UNITS[type] || BUILDINGS[type]).name}`).join(' · ')}`;
    } else if (first.kind === 'building') {
      const job = first.queue?.[0], producer = ['barracks', 'factory', 'refinery'].includes(buildingRole(first));
      const activity = [first.research ? `${RESEARCH[first.research.id].name} ${Math.floor(first.research.progress * 100)}%` : job ? `${UNITS[job.type].name} ${Math.floor(job.progress * 100)}%` : first.processingAmount > 0 ? 'Processing minerals' : producer ? 'Idle · bay empty' : buildingRole(first) === 'lab' ? 'Idle · choose a research project' : 'Operational'];
      if (buildingRole(first) === 'capacitor') activity.splice(0, 1, `${Math.round(first.reserve || 0)} stored · ${power.usingReserve && first.reserve > 0 ? 'Reserve available' : first.reserve >= BUILDINGS[first.type].reserveCapacity ? 'Fully charged' : power.supply > power.demand ? 'Charging from surplus' : 'Waiting for spare power'}`);
      if (first.upgrade) activity.push(`${BUILDING_UPGRADES[first.upgrade.id].name} ${Math.floor(first.upgrade.progress * 100)}%`);
      if (low && BUILDINGS[first.type].power < 0) activity.unshift('Brownout');
      if (first.processingAmount > 0) activity.push(`${Math.ceil(first.processingAmount)} shards remaining`);
      if (first.haulerPending) activity.push('Included hauler awaiting deployment');
      if (first.repairing) activity.unshift(game.teams[0].credits > 0 ? 'Repairing' : 'Repair waiting for credits');
      detail = first.progress < 1 ? `Under construction · ${Math.floor(first.progress * 100)}%` : `${Math.ceil(first.hp)} / ${first.maxHp} integrity · ${activity.join(' · ')}`;
      if (selectedProducers().length) detail += first.rally ? ` · Rally ${Math.floor(first.rally.x)}:${Math.floor(first.rally.y)}` : ' · Set rally with R or right click';
    }
    else if (unitRole(first) === 'harvester') {
      const cargo = (first.cargo || 0) * (first.unloadDepotId ? Math.max(0, 1 - (first.unload || 0) / 1.2) : 1);
      detail = `${cargo < 1 ? 'Empty' : cargo >= UNITS[first.type].capacity ? 'Full' : `Cargo ${Math.ceil(cargo)} / ${UNITS[first.type].capacity}`} · ${first.unloadDepotId ? 'Unloading minerals' : first.order?.type === 'explore' ? 'Auto-exploring' : first.order?.type === 'move' ? 'Relocating · auto-harvest next' : first.harvestPhase === 'return' ? 'Returning cargo' : 'Auto-harvesting'}`;
    }
    else detail = `${Math.ceil(first.hp)} / ${first.maxHp} integrity · ${first.order?.type === 'explore' ? `Auto-exploring${first.targetId ? ' · Engaging' : ''}` : first.order?.type === 'move' ? 'Moving' : unitRole(first) === 'engineer' ? first.repairTargetId ? 'Repairing nearby machinery' : 'Auto-repair within 4 tiles' : first.targetId || first.order?.type === 'attack' ? 'Engaging' : first.order?.type === 'attackMove' ? 'Advancing' : 'Guarding'}`;
  }
  if (selection.length === 1 && first.kind === 'unit' && terrainCover(game, first) > 0) detail += ' · 15% crater cover';
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
  const portraitKey = first ? `${first.id}:${first.type}:${Math.floor(first.progress * 10)}:${first.queue?.[0]?.type}:${Math.floor((first.queue?.[0]?.progress || 0) * 10)}:${Math.ceil((first.processingAmount || 0) / 50)}:${first.processingType}:${first.cargoType}:${Math.ceil((first.cargo || 0) * (first.unloadDepotId ? Math.max(0, 1 - (first.unload || 0) / 1.2) : 1) / 50)}:${Math.round(power.ratio * 20)}:${power.status}:${Math.round((first.research?.progress || 0) * 10)}:${Math.round((first.reserve || 0) / 100)}:${Math.round((first.upgrade?.progress || 0) * 10)}` : 'core';
  if (portraitKey !== lastPortrait) { drawIcon($('portrait'), first?.type || raceBuilding(game, 0, 'core'), 0, { ...first, powerRatio: power.ratio, powerStatus: power.status }); lastPortrait = portraitKey; }
  for (const id of ['move-order', 'attack-order', 'explore-order', 'stop-order']) { $(id).disabled = busy() || !units.length; $(id).hidden = !units.length; }
  $('rally-order').hidden = !selectedProducers().length;
  $('rally-order').disabled = busy() || !selectedProducers().length;
  const building = selection.length === 1 && first.kind === 'building' ? first : null;
  for (const id of ['repair-building', 'sell-building', 'building-actions-note']) $(id).hidden = !building;
  if (building) {
    const repair = $('repair-building'), sell = $('sell-building'), refund = salvageValue(building);
    repair.disabled = busy() || building.progress < 1 || building.hp >= building.maxHp;
    repair.setAttribute('aria-pressed', String(Boolean(building.repairing)));
    repair.classList.toggle('active', Boolean(building.repairing));
    $('repair-label').textContent = building.repairing ? 'Stop repair' : 'Repair';
    const repairRate = power.ratio * 2, repairCost = BUILDINGS[building.type].cost / 100 * power.ratio;
    repair.title = `Restore ${Number(repairRate.toFixed(1))}% integrity per second at current power. A full health bar costs half the structure price; waits if credits run out.`;
    sell.disabled = busy() || buildingRole(building) === 'core';
    $('sell-label').textContent = `Sell +${fmt(refund)}`;
    sell.title = buildingRole(building) === 'core' ? 'The command nexus cannot be sold' : `Sell immediately for ${refund} credits, including paid unit queues, research and pending upgrades. Haulers keep their cargo.`;
    const notes = [building.progress < 1 ? 'Finish construction to repair.' : building.repairing && game.teams[0].credits <= 0 ? 'Waiting for credits; repair resumes automatically.' : `Repair: ${Number(repairRate.toFixed(1))}% HP/s · ${Number(repairCost.toFixed(1))} credits/s${low ? ' at current power' : ''}.`];
    if (buildingRole(building) === 'core') notes.push('Nexus cannot be sold.');
    if (buildingRole(building) === 'refinery' && !building.haulerPending) notes.push('Hauler value excluded from sale.');
    const paidJobs = building.queue.reduce((sum, q) => sum + UNITS[q.type].cost, 0) + (RESEARCH[building.research?.id]?.cost || 0) + (BUILDING_UPGRADES[building.upgrade?.id]?.cost || 0);
    if (paidJobs) notes.push(`Sale includes ${fmt(paidJobs)} pending credits.`);
    $('building-actions-note').textContent = notes.join(' ');
  }
  const exploring = units.filter(e => e.order?.type === 'explore').length;
  $('explore-order').setAttribute('aria-pressed', exploring ? exploring === units.length ? 'true' : 'mixed' : 'false');
  $('explore-order').classList.toggle('active', exploring > 0);
  $('select-army').disabled = busy();
  const queue = []; let queueCount = 0;
  for (const e of game.entities) if (e.team === 0 && e.kind === 'building' && e.hp > 0) {
    if (e.progress < 1) { queue.push({ id: e.id, name: BUILDINGS[e.type].name, progress: e.progress, label: 'Construction' }); queueCount++; }
    if (e.queue?.length) {
      queueCount += e.queue.length;
      queue.push({ id: e.id, name: UNITS[e.queue[0].type].name, progress: e.queue[0].progress || 0, label: `${BUILDINGS[e.type].name} #${e.id}${e.queue.length > 1 ? ` · +${e.queue.length - 1} waiting` : ''}` });
    }
    if (e.research) { queueCount++; queue.push({ id: `r${e.id}`, name: RESEARCH[e.research.id].name, progress: e.research.progress, label: `Research · lab #${e.id}` }); }
    if (e.upgrade) { queueCount++; queue.push({ id: `u${e.id}`, name: BUILDING_UPGRADES[e.upgrade.id].name, progress: e.upgrade.progress, label: `Upgrade · ${BUILDINGS[e.type].name}` }); }
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
  updateBuildingUpgrades(); updateCatalog();
  const hover = view.hover, at = hover ? Math.floor(hover.y) * game.width + Math.floor(hover.x) : -1;
  const known = hover && hover.x >= 0 && hover.y >= 0 && hover.x < game.width && hover.y < game.height && game.explored[0][at];
  let groundHint = '';
  if (known) {
    const ore = game.visible[0][at] ? game.minerals[at] : renderer.knownOre?.[at];
    if (ore > 0) { const type = renderer.knownMineralTypes?.[at] || game.mineralTypes[at] || 1; groundHint = `${['', 'Mint shards', 'Blue shards', 'Red shards · 2× density'][type]} · ${fmt(ore)} credits`; }
    else groundHint = ({1:'Raised ridge · impassable', 3:'Molten lava · impassable', 4:'Twisted roots · obstructed', 5:'Crater · 15% direct-fire cover · no construction'})[game.terrain[at]] || '';
  }
  $('terrain-readout').textContent = groundHint; $('terrain-readout').hidden = !groundHint || Boolean(view.placement);
  document.body.style.setProperty('--selection-height', panel.hidden ? '0px' : `${panel.getBoundingClientRect().height}px`);
  const hint = $('order-hint');
  document.body.style.setProperty('--order-hint-height', hint.hidden ? '0px' : `${hint.getBoundingClientRect().height}px`);
}

function showMenu(finished = false, guide = false) {
  stopFrames();
  paused = true; keys.clear(); pointer = null; view.drag = null;
  audio.setPaused(true);
  $('menu-title').textContent = finished ? game.status === 'victory' ? 'The frontier is yours.' : 'The line has fallen.' : 'Hold the line.';
  $('menu-description').textContent = finished ? game.status === 'victory' ? `${RACES[teamRace(game, 1)].name} command is down. Your forces hold the sector.` : 'Your command core was destroyed. Regroup and take another sector.' : 'The battlefield is paused.';
  $('resume').hidden = finished;
  $('match-summary').hidden = !finished;
  if (finished) $('match-summary').textContent = `${minutes(game.time)} in field  ·  ${game.teams[0].kills || 0} enemies destroyed`;
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
  lastTime = performance.now(); requestFrame();
}

function updateSoundButton() {
  const { sfxEnabled, musicEnabled } = audio.status;
  $('sound').setAttribute('aria-pressed', String(sfxEnabled));
  $('sound').setAttribute('aria-label', sfxEnabled ? 'Mute sound effects' : 'Enable sound effects');
  $('sfx-toggle').setAttribute('aria-pressed', String(sfxEnabled));
  $('sfx-toggle').textContent = `Effects ${sfxEnabled ? 'on' : 'off'}`;
  $('music-toggle').setAttribute('aria-pressed', String(musicEnabled));
  $('music-toggle').textContent = `Music ${musicEnabled ? 'on' : 'off'}`;
}

function refreshSaveControls(message) {
  const info = getSaveInfo();
  const description = info.ok ? `${info.seed} · ${minutes(info.time)} · ${new Date(info.savedAt).toLocaleString()}` : info.reason;
  $('save-status').textContent = message || description;
  $('saved-operation').textContent = message || description;
  $('saved-operation').parentElement.hidden = !info.ok && !message;
  $('load-game').disabled = $('load-saved').disabled = loading || !info.ok;
  $('save-game').disabled = !launched || game.status !== 'playing';
}

function saveOperation() {
  const result = saveGame(game, { ...view, rememberedBuildings: [...renderer.rememberedBuildings.values()], knownOre: renderer.knownOre });
  refreshSaveControls(result.ok ? 'Operation saved in this browser.' : result.reason);
}

function updateLoading(value, label) {
  const progress = $('loading-progress');
  progress.value = Math.max(progress.value, Math.min(100, value));
  $('loading-percent').textContent = `${Math.floor(progress.value)}%`;
  $('loading-stage').textContent = label;
}

async function prepareOperation(restore = false) {
  if (loading) return;
  stopFrames();
  const previousGame = game, previousLaunched = launched;
  loading = true; paused = true; launched = false;
  audio.unlock(); audio.setPaused(true);
  $('loading-title').textContent = restore ? 'Returning to the frontier' : 'Preparing the frontier';
  $('loading-progress').value = 0;
  $('loading-back').hidden = true; $('loading-back').textContent = 'Back to setup';
  delete $('loading-back').dataset.reload;
  $('loading').removeAttribute('data-error');
  $('loading').setAttribute('aria-busy', 'true');
  updateLoading(0, restore ? 'Reading your saved operation' : 'Preparing your expedition');
  $('briefing').close(); $('menu').close();
  document.body.dataset.screen = 'loading';
  $('loading').showModal();
  let assetTimer;
  try {
    // Paint the loading screen before decoding saves, preparing sprites, or seeding terrain.
    await nextPaint();
    const restored = restore ? loadGame() : null;
    if (restored && !restored.ok) {
      loading = false; game = previousGame; launched = previousLaunched;
      $('loading').setAttribute('aria-busy', 'false'); $('loading').close();
      if (previousLaunched) {
        document.body.dataset.screen = 'game'; showMenu(game.status !== 'playing');
      } else showBriefing();
      refreshSaveControls(restored.reason);
      return;
    }
    const seed = restored?.game.seed || $('seed').value.trim() || randomSeed();
    $('seed').value = seed;
    if (restored) {
      $('difficulty').value = restored.game.difficulty;
      const size = Object.keys(MAP_SIZES).find(id => MAP_SIZES[id].width === restored.game.width && MAP_SIZES[id].height === restored.game.height);
      if (size) $('map-size').value = size;
      $('map-profile').value = restored.game.mapProfile || 'rift';
      $('player-race').value = teamRace(restored.game, 0); $('enemy-race').value = teamRace(restored.game, 1);
      updateMapDescription();
    }
    updateLoading(2, 'Loading units and structures');
    assetTimer = setInterval(() => updateLoading(2 + assetStatus.loaded / assetStatus.total * 32,
      assetStatus.loaded === assetStatus.total ? 'Preparing faction colors' : `Loading units and structures · ${assetStatus.loaded} / ${assetStatus.total}`), 60);
    await startAssets();
    clearInterval(assetTimer);
    if (!assetStatus.ready) { $('loading-back').dataset.reload = 'true'; $('loading-back').textContent = 'Reload and retry'; throw new Error('Some battlefield art could not load. Reload the page to retry.'); }
    updateLoading(35, restore ? 'Restoring the sector' : 'Generating the sector');
    await nextPaint();
    const prepared = restored?.game || await generateOperation(seed, $('difficulty').value, {
      ...MAP_SIZES[$('map-size').value], profile: $('map-profile').value, races: [$('player-race').value, $('enemy-race').value],
    });
    updateLoading(40, 'Laying the ashlands');
    await nextPaint();
    await reset(prepared, restored);
    updateLoading(99, 'Establishing command');
    await nextPaint();
    renderer.draw(game, view);
    updateLoading(100, 'Your expedition is ready');
    await nextPaint();
    loading = false; launched = true;
    document.body.dataset.screen = 'game';
    $('loading').setAttribute('aria-busy', 'false'); $('loading').close();
    lastTime = performance.now(); accumulator = 0;
    if (restored) {
      showMenu(game.status !== 'playing');
      $('menu-description').textContent = 'Operation restored. Resume when ready.';
      refreshSaveControls('Loaded the saved operation.');
    } else {
      paused = false; audio.setPaused(false);
      $('pause').textContent = 'Ⅱ'; $('pause').setAttribute('aria-label', 'Pause game');
      canvas.focus({ preventScroll: true }); updateHUD(); playSound('confirm');
      notify(`${RACES[teamRace(game, 0)].name} deployed. Build ${BUILDINGS[raceBuilding(game, 0, 'barracks')].name} and recruit your first squad.`);
    }
    requestFrame();
  } catch (error) {
    clearInterval(assetTimer);
    loading = false; game = null;
    $('loading').dataset.error = 'true'; $('loading').setAttribute('aria-busy', 'false');
    $('loading-title').textContent = 'The expedition could not start';
    $('loading-stage').textContent = error.message || 'Please return to setup and try again.';
    $('loading-back').hidden = false; $('loading-back').focus();
  }
}

function loadOperation() { return prepareOperation(true); }

function showBriefing() {
  stopFrames();
  launched = false; paused = true; game = null;
  $('queue-list').replaceChildren();
  keys.clear(); groups.clear(); view.selected.clear();
  audio.setPaused(true);
  document.body.dataset.screen = 'briefing';
  $('loading').close(); $('menu').close();
  refreshSaveControls();
  if (!$('briefing').matches(':modal')) { $('briefing').close(); $('briefing').showModal(); }
  $('deploy').focus({ preventScroll: true });
}

function selectArmy() {
  if (busy()) return;
  view.selected = new Set(game.entities.filter(e => e.team === 0 && e.kind === 'unit' && unitRole(e) !== 'harvester' && e.hp > 0).map(e => e.id));
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
  view.zoom = steppedZoom(view.zoom, amount > 1 ? 1 : -1, cameraLevels());
  if (before) { const after = renderer.screenToWorld(point.x, point.y, view); view.x += before.x - after.x; view.y += before.y - after.y; }
  clampCamera(); updateZoomLabel();
}

function updateZoomLabel() {
  const levels = cameraLevels(), index = levels.indexOf(nearestZoom(view.zoom, levels));
  preferredZoomIndex = index;
  $('zoom-level').textContent = `${index + 1}/5`;
  $('zoom-level').title = `${Math.round(view.zoom / levels[4] * 100)}% native resolution${index === 4 ? ' · 1:1 maximum' : ''}`;
  $('zoom-out').disabled = index === 0; $('zoom-in').disabled = index === 4;
}

function localPoint(event) {
  const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch') {
    canvas.setPointerCapture(event.pointerId); touches.set(event.pointerId, localPoint(event)); pinchDistance = 0;
    if (touches.size > 1 && pointer) { pointer.wall = false; pointer.pan = true; pointer.dragged = true; view.wallStart = null; view.wallPlan = null; }
  }
  if (busy() || pointer) return;
  event.preventDefault(); canvas.focus({ preventScroll: true });
  const point = localPoint(event), world = renderer.screenToWorld(point.x, point.y, view);
  canvas.setPointerCapture(event.pointerId);
  pointer = { id: event.pointerId, button: event.button, touch: event.pointerType === 'touch', start: point, last: point, startWorld: world, shift: event.shiftKey, dragged: false, pan: event.button === 1 || event.pointerType === 'touch' };
  if (view.placement === 'wall' && event.button === 0) {
    pointer.wall = true; pointer.pan = false; view.wallStart = { x: Math.floor(world.x), y: Math.floor(world.y) };
  }
  pointerPosition = point;
});
canvas.addEventListener('pointermove', event => {
  const point = localPoint(event); pointerPosition = point;
  view.hover = renderer.screenToWorld(point.x, point.y, view);
  $('coordinates').textContent = `${String(Math.floor(view.hover.x)).padStart(2, '0')} : ${String(Math.floor(view.hover.y)).padStart(2, '0')}`;
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId, point);
    if (touches.size === 2 && pointer) {
      // Pinch: zoom around the midpoint; the primary pointer keeps panning (pan stays true) so no tap or box select fires on release.
      const [a, b] = [...touches.values()], distance = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!pinchDistance) pinchDistance = distance;
      if (!busy() && (distance / pinchDistance > 1.14 || distance / pinchDistance < 1 / 1.14)) { zoom(distance / pinchDistance, mid); pinchDistance = distance; }
      pointer.dragged = true; view.drag = null;
      if (event.pointerId === pointer.id) pointer.last = point;
      return;
    }
  }
  if (!pointer || event.pointerId !== pointer.id || busy()) return;
  if (Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) > 6) pointer.dragged = true;
  if (pointer.dragged) {
    if (pointer.pan) { view.x -= (point.x - pointer.last.x) / view.zoom; view.y -= (point.y - pointer.last.y) / view.zoom; clampCamera(); }
    else if (pointer.button === 0 && !view.placement && !orderMode) view.drag = { x1: pointer.start.x, y1: pointer.start.y, x2: point.x, y2: point.y };
  }
  pointer.last = point;
});
canvas.addEventListener('pointerup', event => {
  if (touches.delete(event.pointerId) && pinchDistance) { pinchDistance = 0; if (pointer && touches.size === 1) pointer.last = touches.values().next().value; }
  if (!pointer || event.pointerId !== pointer.id) return;
  const active = pointer; pointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (busy()) return;
  const point = localPoint(event), world = renderer.screenToWorld(point.x, point.y, view);
  if (active.wall && view.wallStart && view.placement === 'wall') {
    const result = buildWallLine(game, 0, view.wallStart.x, view.wallStart.y, Math.floor(world.x), Math.floor(world.y));
    view.wallStart = null; view.wallPlan = null; view.drag = null;
    notify(result.count ? `${result.count} wall segments ordered · ${result.cost} credits${result.reason ? ` · ${result.reason}` : ''}` : result.reason || 'Wall line could not be placed.', !result.count);
    if (result.count) playSound('build'); updateHUD(); setOrderHint(); return;
  }
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
canvas.addEventListener('pointercancel', event => { touches.delete(event.pointerId); pinchDistance = 0; pointer = null; view.drag = null; view.wallStart = null; view.wallPlan = null; });
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
canvas.addEventListener('wheel', event => {
  event.preventDefault(); if (busy()) return;
  if (Math.sign(wheelTravel) !== Math.sign(event.deltaY)) wheelTravel = 0;
  wheelTravel += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? renderer.height : 1);
  if (Math.abs(wheelTravel) >= 32 && performance.now() - lastZoomAt > 140) {
    zoom(wheelTravel < 0 ? 2 : .5, localPoint(event)); wheelTravel = 0; lastZoomAt = performance.now();
  }
}, { passive: false });
document.addEventListener('pointermove', event => {
  edgePointer = event.pointerType === 'mouse' && !event.target.closest('button, input, select, dialog, .sidebar, .tactical-map, .commandbar') ? localPoint(event) : null;
});
document.documentElement.addEventListener('pointerleave', () => { edgePointer = null; });

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
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
  keys.add(key);
  if (event.repeat) return;
  if (key === 'escape') { if (view.placement || orderMode || view.selected.size) { cancelOrder(); view.selected.clear(); updateHUD(); } else if (!$('command-console').hidden) setConsole(false); else showMenu(); }
  else if (key === 'b') { event.preventDefault(); setConsole($('command-console').hidden); }
  else if (key === 'p') showMenu();
  else if (key === 'q') setOrder('attackMove');
  else if (key === 'r') setOrder('rally');
  else if (key === 'h') stopSelection();
  else if (key === 'x') toggleExplore();
  else if (key === 'e') selectArmy();
  else if (key === ' ') centerBase();
  else if (/^Digit[1-5]$/.test(event.code)) {
    const digit = event.code.slice(-1);
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.shiftKey) { groups.set(digit, [...view.selected]); notify(`Control group ${digit} assigned.`); }
    else if (groups.has(digit)) { view.selected = new Set(groups.get(digit).filter(id => getEntity(game, id)?.hp > 0)); updateHUD(); }
  }
  else if (key === '+' || key === '=') zoom(1.15);
  else if (key === '-') zoom(1 / 1.15);
});
document.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); touches.clear(); pointer = null; pointerPosition = null; edgePointer = null; view.drag = null; if (launched && !paused && game.status === 'playing') showMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && launched && !paused && game.status === 'playing') showMenu(); });
window.addEventListener('resize', () => { renderer.resize(); if (game) { view.zoom = nearestZoom(view.zoom, cameraLevels()); clampCamera(); updateZoomLabel(); if (paused && !loading && renderer.terrainSource === game.terrain) renderer.draw(game, view); } });

compactScreen.addEventListener('change', event => { if (event.matches) setConsole(false); });
$('command-toggle').addEventListener('click', () => setConsole($('command-console').hidden));
$('command-close').addEventListener('click', () => setConsole(false));
document.querySelector('.console-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const tabs = ['build', 'train', 'research'];
  const tab = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(activeTab) + (event.key === 'ArrowRight' ? 1 : 2)) % tabs.length];
  setTab(tab); $(`${tab}-tab`).focus();
});
$('build-tab').addEventListener('click', () => setTab('build'));
$('train-tab').addEventListener('click', () => setTab('train'));
$('research-tab').addEventListener('click', () => setTab('research'));
$('upgrade-building').addEventListener('click', () => { setConsole(true); setTab('research'); $('command-console').scrollTop = 0; });
$('attack-order').addEventListener('click', () => setOrder('attackMove'));
$('move-order').addEventListener('click', () => setOrder('move'));
$('rally-order').addEventListener('click', () => setOrder('rally'));
$('repair-building').addEventListener('click', () => {
  if (busy()) return;
  const selection = selectedEntities(); if (selection.length !== 1) return;
  const result = toggleRepair(game, selection[0].id);
  if (!result.ok) notify(result.reason, true); else playSound('confirm');
  updateHUD();
});
$('sell-building').addEventListener('click', () => {
  if (busy()) return;
  const selection = selectedEntities(); if (selection.length !== 1) return;
  const result = sellBuilding(game, selection[0].id);
  if (!result.ok) notify(result.reason, true);
  else { cancelOrder(); playSound('confirm'); notify(`Structure sold · +${fmt(result.refund)} credits`); }
  updateHUD(); updateCatalog();
});
$('stop-order').addEventListener('click', stopSelection);
$('deselect').addEventListener('click', () => { cancelOrder(); view.selected.clear(); updateHUD(); });
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
  cancelOrder(); $('seed').value = randomSeed(); showBriefing();
});
$('loading').addEventListener('cancel', event => event.preventDefault());
$('loading-back').addEventListener('click', () => { if ($('loading-back').dataset.reload) location.reload(); else showBriefing(); });
$('random-seed').addEventListener('click', () => { $('seed').value = randomSeed(); });
function updateMapDescription() {
  const size = MAP_SIZES[$('map-size').value];
  $('race-description').textContent = RACES[$('player-race').value].description;
  $('map-description').textContent = `${MAP_PROFILES[$('map-profile').value].description} ${fmt(size.width * size.height)} tiles to explore.`;
}
for (const id of ['map-profile', 'map-size', 'player-race', 'enemy-race']) $(id).addEventListener('change', updateMapDescription);
$('launch-form').addEventListener('submit', event => { event.preventDefault(); prepareOperation(); });

function requestFrame() {
  if (!frameRequest && launched && !paused && !loading) frameRequest = requestAnimationFrame(frame);
}
function stopFrames() { if (frameRequest) cancelAnimationFrame(frameRequest); frameRequest = 0; }

function frame(now) {
  frameRequest = 0;
  if (!launched || loading || !game) return;
  if (paused) { updateHUD(); return; }
  const elapsed = Math.min((now - lastTime) / 1000, .2); lastTime = now;
  if (!busy()) {
    accumulator += elapsed;
    while (accumulator >= .05) {
      updateGame(game, .05); accumulator -= .05;
      if (game.status !== 'playing') { showMenu(true); playSound(game.status); accumulator = 0; break; }
    }
    const panSpeed = 400 / view.zoom * elapsed;
    const direction = cameraDirection(keys, !pointer?.pan && !touches.size ? edgePointer : null, renderer.width, renderer.height);
    view.x += direction.x * panSpeed; view.y += direction.y * panSpeed;
    clampCamera();
    if (game.events.length < lastEvent) lastEvent = 0;
    for (let i = lastEvent; i < game.events.length; i++) {
      const event = game.events[i];
      if (event.team !== 0 && event.team !== undefined) continue;
      if (event.text.startsWith('Shard delivery:')) { playSound('delivery'); continue; }
      if (/ online$/.test(event.text)) playSound('buildComplete');
      else if (/ ready$/.test(event.text)) playSound('unitReady');
      // Warnings: under attack, low power, the last hauler lost, or a friendly structure destroyed; the victory line ("Hostile nexus destroyed") and single unit losses stay plain.
      if (event.text !== lastNotice) { const warn = /attack|low power|bay blocked|^All haulers lost|^(?!Hostile).*destroyed/i.test(event.text); notify(event.text, warn, !warn); lastNotice = event.text; }
    }
    lastEvent = game.events.length;
    for (const effect of game.effects) {
      if (heardEffects.has(effect)) continue;
      heardEffects.add(effect);
      const v = game.visible[0], W = game.width, at = (x, y) => v[Math.floor(y) * W + Math.floor(x)];
      if (!at(effect.x, effect.y) && !((effect.type === 'shot' || effect.type === 'shell' || effect.type === 'rocket') && Number.isFinite(effect.tx) && at(effect.tx, effect.ty))) continue;
      if (effect.type === 'shot' || effect.type === 'shell' || effect.type === 'rocket') playSound(UNITS[effect.weapon] ? unitRole(effect.weapon) : BUILDINGS[effect.weapon] ? buildingRole(effect.weapon) : 'rifle');
      else if (effect.type === 'explosion') playSound('explosion');
    }
  }
  if (pointerPosition && !busy()) view.hover = renderer.screenToWorld(pointerPosition.x, pointerPosition.y, view);
  if (view.placement === 'wall' && view.hover && !busy()) {
    const to = { x: Math.floor(view.hover.x), y: Math.floor(view.hover.y) }, from = view.wallStart || to;
    const key = `${from.x}:${from.y}:${to.x}:${to.y}:${game.navVersion}`;
    if (key !== wallPreviewKey || now - wallPreviewAt > 150 || !view.wallPlan) {
      view.wallPlan = planWallLine(game, 0, from.x, from.y, to.x, to.y); wallPreviewKey = key; wallPreviewAt = now; setOrderHint();
    }
  } else view.wallPlan = null;
  const check = view.placement && view.hover ? canPlace(game, 0, view.placement, Math.floor(view.hover.x), Math.floor(view.hover.y)) : null;
  view.placementValid = Boolean(check?.ok);
  if ((check?.reason || '') !== view.placementReason) { view.placementReason = check?.reason || ''; setOrderHint(); }
  if (view.commandMarker && now / 1000 - view.commandMarker.time > .85) view.commandMarker = null;
  renderer.draw(game, view);
  if (now - hudTimer > 150) {
    updateHUD(); hudTimer = now;
  }
  if (toastUntil && now > toastUntil) { $('notifications').className = ''; toastUntil = 0; lastNotice = ''; }
  requestFrame();
}

$('seed').value = randomSeed();
updateMapDescription(); updateSoundButton();
$('deploy').disabled = false;
showBriefing();

// Menu readiness is separate from battlefield readiness: no world exists before deployment.
window.ashline = { booted: true, get state() { return game; }, view, renderer, assets: assetStatus,
  get loading() { return loading; }, get paused() { return paused; }, get audio() { return audio.status; } };
