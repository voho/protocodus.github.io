import { BUILDINGS, UNITS, UNIT_CAP, UNIT_CAP_PER_NEXUS, unitCapacity, deploymentStatus, deployNexus, RESEARCH, BUILDING_UPGRADES, MAP_SIZES, MAP_PROFILES, RACES, buildingRole, unitRole, teamRace, raceBuilding, raceUnit, planWallLine, buildWallLine, terrainCover, researchStatus, startResearch, cancelResearch, buildingUpgradeStatus, startBuildingUpgrade, updateGame, placeBuilding, canPlace, trainUnit, cancelTraining, setRallyPoint, issueOrder, stopUnits, setUnitStance, effectiveUnitStance, powerStats, productionRate, getEntity, unitRank, unitStats, toggleRepair, sellBuilding, salvageValue } from './sim.js';
import { ABILITIES, abilityFor, abilityStatus, useAbility } from './abilities.js';
import { DOCTRINES, doctrineOptions, randomDoctrine } from './ai.js';
import { MISSIONS, SKIRMISH_MODES } from './campaign.js';
import { callsign, barkLine, rivalCommander, approachingColumn } from './character.js';
import { eventRoute, witnessedKill, cardStats, ARMOR_CLASSES, idleSummary, readSettings, writeSettings } from './hud-data.js';
import { Renderer, drawIcon } from './render.js';
import { startAssets, assetStatus, spriteNativeZoom } from './assets.js';
import { zoomLevels, nearestZoom, steppedZoom, cameraDirection } from './camera.js';
import { createAudio } from './audio.js';
import { createSoundscape, bindAudioControls } from './soundscape.js';
import { saveGame, loadGame, getSaveInfo } from './save.js';
import { nextPaint, generateOperation } from './loading.js';
import { assignControlGroup, controlGroupMembers } from './control-groups.js';
import { advanceSimulationFrame } from './frame-scheduler.js';

const $ = id => document.getElementById(id);
const canvas = $('world'), tacticalMap = document.querySelector('.tactical-map');
const compactScreen = matchMedia('(max-width: 680px)');
const renderer = new Renderer(canvas, $('minimap'));
const view = { x: 14, y: 37, zoom: innerWidth <= 680 ? 24 : 38, selected: new Set(), hover: null, placement: null, placementValid: false, placementReason: '', drag: null, formationPreview: null, commandMarker: null, showGrid: false };
let frameRequest = 0;
let game = null, launched = false, paused = true, loading = false, activeTab = 'build', orderMode = null;
let lastTime = performance.now(), accumulator = 0, hudTimer = 0, lastEvent = 0;
const settings = readSettings();
let gameSpeed = settings.speed / 100;
view.screenShake = settings.shake;
let pointer = null, pointerPosition = null, lastPortrait = '', lastQueue = '', lowPower = false, pinchDistance = 0;
const touches = new Map();
let edgePointer = null, wheelTravel = 0, lastZoomAt = 0;
let wallPreviewKey = '', wallPreviewAt = 0;
let preferredZoomIndex = compactScreen.matches ? 1 : 2;
const cameraLevels = () => zoomLevels(spriteNativeZoom(renderer.dpr));
const audio = createAudio();
audio.setPaused(true);
const soundscape = createSoundscape(audio);
const keys = new Set();
// Message log, alert history and unit comms are interface state only; none of it enters the save.
const toasts = [], alerts = [], announcements = new Map();
let alertCursor = -1, alertCursorAt = 0, announcing = false;
// Promotions earned on kills the player did not see wait here until the unit is next selected.
const heldPromotions = new Map();
// The role whose ground ability the pending target click belongs to.
let abilityRole = null;
let barkUntil = 0, barkSequence = 0;
let lastGroupPress = { group: null, at: 0 }, interceptAt = -Infinity, interceptCheckAt = 0, sliderPointer = false;
const idleCursor = { units: 0, production: 0 };
let idle = idleSummary(null), idleCheckedAt = -Infinity;
// Console card keys: the free top-row letters, then the free home-row letters, in card order.
const CARD_KEYS = ['t', 'y', 'u', 'i', 'o', 'g', 'j', 'k', 'l'];
const buildTypes = ['reactor', 'refinery', 'barracks', 'factory', 'lab', 'capacitor', 'turret', 'rocketTower', 'wall'];
const unitTypes = ['rifle', 'rocket', 'scout', 'tank', 'artillery', 'striker', 'engineer', 'harvester', 'constructor'];
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
const isProducer = e => e.kind === 'building' && ['barracks', 'factory', 'refinery'].includes(buildingRole(e));
const selectedProducers = () => selectedEntities().filter(isProducer);
// The HUD passes its own producer list so a refresh scans the entity list once, not once per card.
const chosenProducer = (type, producers = selectedProducers()) => {
  const matching = producers.filter(e => e.type === UNITS[type].producer);
  return matching.length === 1 ? matching[0] : null;
};
const seconds = value => Number.isFinite(value) ? `${Math.ceil(value)}s` : 'stalled';
const busy = () => !launched || paused || game.status !== 'playing';
const cardMeta = def => `${def.buildTime || def.trainTime}s` + (def.power < 0 ? ` · ${-def.power}ϟ` : def.power > 0 ? ` · +${def.power}ϟ` : '');

function playSound(kind = 'confirm') {
  audio.play(kind);
}
// One answer per command: the interface cue, then a single reply from the units. The soundscape picks
// who answers and with which line (it owns the annoyed-reselect count); the comms line shows that same
// line, so the voice and the text always agree.
function acknowledge(context = 'select', cue = 'select', units = selectedUnits()) {
  playSound(cue);
  const reply = game && soundscape.acknowledge(context, units);
  if (reply) bark(reply.unit, reply.context);
}

const TOAST_LIFE = { info: 4300, success: 5000, caution: 5500, loss: 5500, warning: 6500, comms: 7000 };
// A short stacked log: each line fades on its own, repeats refresh their line with a count, and a
// full log drops its oldest routine line before any warning. Lines about a place can be clicked.
// detail: {x, y, speaker, quiet}. A warning buzzes the error cue unless it is quiet; every simulation
// event is quiet because the soundscape already gives it its own stinger.
function notify(text, tone = 'info', detail = {}) {
  const log = $('notifications'), now = performance.now();
  let toast = toasts.find(t => t.text === text && t.tone === tone);
  if (toast) {
    toasts.splice(toasts.indexOf(toast), 1); toast.count++;
    toast.element.querySelector('.toast-count').textContent = `×${toast.count}`;
    toast.element.classList.remove('leaving');
  } else {
    const element = document.createElement('div'); element.className = 'toast'; element.dataset.tone = tone;
    if (detail.speaker) { const speaker = document.createElement('b'); speaker.className = 'toast-speaker'; speaker.textContent = detail.speaker; element.append(speaker); }
    const body = document.createElement('span'); body.className = 'toast-text'; body.textContent = text;
    const count = document.createElement('span'); count.className = 'toast-count';
    element.append(body, count);
    toast = { text, tone, count: 1, element };
    while (toasts.length >= 4) {
      const routine = toasts.findIndex(t => t.tone !== 'warning' && t.tone !== 'loss');
      removeToast(toasts[routine >= 0 ? routine : 0]);
    }
  }
  toast.point = Number.isFinite(detail.x) && Number.isFinite(detail.y) ? { x: detail.x, y: detail.y } : toast.point;
  // Only the small jump mark takes clicks, so a message never swallows an order aimed at the ground beneath it.
  if (toast.point && !toast.element.querySelector('.toast-jump')) {
    // Out of the tab order: the log is hidden from assistive technology and Backspace covers the keyboard.
    const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'toast-jump'; jump.textContent = '⌖'; jump.tabIndex = -1;
    jump.setAttribute('aria-label', `Center on: ${text}`); jump.title = 'Center the camera here · Backspace';
    toast.element.append(jump); toast.element.classList.add('jump');
  }
  toast.until = now + (TOAST_LIFE[tone] ?? TOAST_LIFE.info);
  toasts.push(toast); log.append(toast.element); log.classList.add('show');
  announce(detail.speaker ? `${detail.speaker}: ${text}` : text);
  if (tone === 'warning' && !detail.quiet) playSound('error');
}
function removeToast(toast) {
  const index = toasts.indexOf(toast);
  if (index >= 0) toasts.splice(index, 1);
  toast?.element.remove();
  if (!toasts.length) $('notifications').classList.remove('show');
}
function expireToasts(now) {
  for (const toast of [...toasts]) {
    if (now > toast.until + 260) removeToast(toast);
    else if (now > toast.until) toast.element.classList.add('leaving');
  }
}
function clearLog() {
  for (const toast of [...toasts]) removeToast(toast);
  alerts.length = 0; alertCursor = -1; announcements.clear(); $('announcer').textContent = '';
  heldPromotions.clear();
  barkUntil = 0; $('comms').hidden = true;
}
// Screen readers hear one combined announcement per burst (a frame's events, or one click's feedback).
// Repeats collapse with a count as they do in the visible log, and a long burst ends in a summary.
const ANNOUNCE_LINES = 6;
function announce(text) {
  announcements.set(text, (announcements.get(text) || 0) + 1);
  if (announcing) return;
  announcing = true;
  queueMicrotask(() => {
    const lines = [...announcements].map(([line, count]) => { const said = count > 1 ? `${line} ×${count}` : line; return /[.!?]$/.test(said) ? said : `${said}.`; });
    const extra = lines.length - ANNOUNCE_LINES;
    $('announcer').textContent = (extra > 1 ? [...lines.slice(0, ANNOUNCE_LINES), `${extra} more messages.`] : lines).join(' ');
    announcements.clear(); announcing = false;
  });
}
$('notifications').addEventListener('click', event => {
  const toast = event.target.closest('.toast-jump') && toasts.find(t => t.element === event.target.closest('.toast'));
  if (toast?.point && !busy()) { centerOn(toast.point); canvas.focus({ preventScroll: true }); }
});

// Recent alerts, newest first. Backspace walks back through them; each centres the camera.
function pushAlert(x, y, text, tone) {
  const now = performance.now(), latest = alerts[0];
  if (latest && Math.hypot(latest.x - x, latest.y - y) < 6 && now - latest.at < 4000) Object.assign(latest, { x, y, text, tone, at: now });
  else { alerts.unshift({ x, y, text, tone, at: now }); if (alerts.length > 8) alerts.pop(); }
  alertCursor = -1;
}
function jumpToAlert() {
  if (busy()) return;
  if (!alerts.length) { notify('No recent alerts.'); return; }
  const now = performance.now();
  if (now - alertCursorAt > 5000) alertCursor = -1;
  alertCursor = (alertCursor + 1) % alerts.length; alertCursorAt = now;
  centerOn(alerts[alertCursor]);
}
function centerOn(point) { view.x = point.x; view.y = point.y; clampCamera(); }
function centerOnSelection() {
  const selection = selectedEntities();
  if (!selection.length) return;
  const points = selection.map(entityCenter);
  centerOn({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length });
}
// Alert pings sit on top of the renderer's tactical map, which redraws its overlay every frame.
function drawAlertPings(now) {
  if (!alerts.length || !renderer.minimapBase) return;
  const ctx = $('minimap').getContext('2d'), { s, ox, oy } = renderer.minimapLayout(game);
  ctx.save(); ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0); ctx.lineWidth = 1.5;
  for (const alert of alerts) {
    const age = (now - alert.at) / 1000;
    if (age > 8) continue;
    const phase = age % 1.4 / 1.4;
    ctx.globalAlpha = (1 - phase) * (1 - age / 8); ctx.strokeStyle = alert.tone === 'loss' ? '#d9a764' : '#e29677';
    ctx.beginPath(); ctx.arc(ox + alert.x * s, oy + alert.y * s, 3 + phase * 10, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

// The comms line shows a unit's reply as text: the line the soundscape voices for a command or for the
// unit's own news (ready, ability), or a crew's boast about a promotion the player saw it earn. The
// soundscape decides who answers and when, so the text never runs ahead of or behind the voice.
function bark(unit, context) {
  if (!unit || unit.team !== 0 || unit.kind !== 'unit' || unit.hp <= 0) return;
  const line = barkLine(unit.type, context, barkSequence++);
  if (!line) return;
  $('comms-callsign').textContent = callsign(game, unit); $('comms-text').textContent = line;
  $('comms').classList.remove('leaving'); $('comms').hidden = false;
  barkUntil = performance.now() + 3200;
}

// New simulation events for the player: kind picks the tone, alert and comms reaction; saves from before
// typed events fall back to their text. Every toast here is quiet: the soundscape gives each event its
// own sound. Only the player's own events are read, except to check that a promotion's kill was seen.
function reportEvents(from) {
  const events = game.events;
  for (let i = from; i < events.length; i++) {
    const event = events[i];
    if (event.team !== 0 && event.team !== undefined) continue;
    const route = eventRoute(event), point = Number.isFinite(event.x) && Number.isFinite(event.y) ? { x: event.x, y: event.y } : {};
    let text = event.text;
    if (route.kind === 'promotion') {
      const subject = getEntity(game, event.entityId);
      // A promotion with no living unit to name (or a text-only one) cannot be checked against vision.
      if (subject?.kind !== 'unit' || subject.hp <= 0) continue;
      text = `${callsign(game, subject)} (${UNITS[subject.type].name}) promoted to rank ${event.rank ?? unitRank(subject)}`;
      // A kill the player did not see is never confirmed as it happens: the news waits, without a place
      // or a time, until the unit is next selected (releaseHeldPromotions). Its chevrons update at once.
      if (!witnessedKill(game, event, events[i + 1])) { holdPromotion(subject, event.rank ?? unitRank(subject)); continue; }
      bark(subject, 'promotion');
    } else if (route.kind === 'unitLost' && event.rank > 0 && Number.isInteger(event.entityId) && event.role) {
      const type = raceUnit(game, 0, event.role);
      if (UNITS[type]) text = `${callsign(game, { id: event.entityId, type })} (${UNITS[type].name}) lost · rank ${event.rank} veteran`;
    }
    if (route.alert && Number.isFinite(point.x)) pushAlert(point.x, point.y, text, route.tone);
    if (route.toast) notify(text, route.tone, { ...point, speaker: route.kind === 'dialogue' ? event.speaker : undefined, quiet: true });
  }
}

function holdPromotion(unit, rank) {
  const held = heldPromotions.get(unit.id);
  heldPromotions.set(unit.id, { rank: Math.max(rank, held?.rank ?? 0), armed: !view.selected.has(unit.id) });
}
// Runs with each HUD refresh. A unit selected when it was promoted must be deselected and chosen again,
// so the line never lands at the moment of the unseen kill.
function releaseHeldPromotions() {
  for (const [id, held] of heldPromotions) {
    const unit = getEntity(game, id);
    if (!unit || unit.hp <= 0 || unit.team !== 0) heldPromotions.delete(id);
    else if (!view.selected.has(id)) held.armed = true;
    else if (held.armed) {
      heldPromotions.delete(id);
      notify(`${callsign(game, unit)} (${UNITS[unit.type].name}) promoted to rank ${held.rank}`, 'success', { quiet: true });
    }
  }
}

// A rival column the player can see closing on a structure is called out once in a while, named for
// the commander behind it. It reads only current vision and points at the threatened structure.
function checkIntercept(now) {
  if (now - interceptCheckAt < 2000) return;
  interceptCheckAt = now;
  const column = approachingColumn(game);
  if (!column || now - interceptAt < 45000) return;
  interceptAt = now;
  const commander = rivalCommander(game), text = `Intercept: ${commander ? `${commander} column` : 'hostile column'} advancing · ${column.count} contacts`;
  pushAlert(column.target.x, column.target.y, text, 'warning');
  notify(text, 'warning', { ...column.target, speaker: 'Signals', quiet: true }); playSound('alert.enemySpotted');
}

async function reset(prepared, restored) {
  cancelFormationGesture();
  game = prepared;
  view.selected.clear(); keys.clear();
  view.placement = null; view.deployUnitId = null; view.drag = null; view.hover = null; view.commandMarker = null;
  view.wallStart = null; view.wallPlan = null;
  orderMode = null; pointer = null; pointerPosition = null; accumulator = 0; lastEvent = game.events.length;
  lastPortrait = ''; lastQueue = null; view.showGrid = false; lowPower = false; touches.clear();
  clearLog(); idle = idleSummary(null); idleCheckedAt = -Infinity; idleCursor.units = idleCursor.production = 0; interceptAt = -Infinity; lastGroupPress = { group: null, at: 0 };
  delete $('building-upgrades').dataset.entity;
  soundscape.reset(game);
  renderer.terrainSource = null;
  await renderer.prepareTerrain(game, ({ value, label }) => updateLoading(40 + value * 58, label));
  if (restored) {
    renderer.rememberedBuildings = new Map(restored.rememberedBuildings.map(e => [e.id, e]));
    renderer.knownOre = restored.knownOre;
    // Mineral material is immutable; only previously explored deposits have known colors.
    renderer.knownMineralTypes = Uint8Array.from(game.mineralTypes, (type, i) => game.explored[0][i] ? type : 0);
  }
  setConsole(!compactScreen.matches && !matchMedia('(pointer: coarse)').matches);
  centerBase();
  if (restored?.view) Object.assign(view, restored.view);
  view.zoom = restored?.view?.zoom ? nearestZoom(view.zoom, cameraLevels()) : cameraLevels()[preferredZoomIndex]; clampCamera(); updateZoomLabel();
  setTab('build'); updateHUD();
}

function centerBase() {
  const core = game.entities.find(e => e.team === 0 && buildingRole(e) === 'core' && e.hp > 0) || game.entities.find(e => e.team === 0 && e.kind === 'unit' && unitRole(e) === 'constructor' && e.hp > 0);
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
  if (!open) hideCardTooltip();
  $('command-console').hidden = !open;
  $('command-toggle').setAttribute('aria-expanded', String(open));
  document.body.dataset.commands = String(open);
  if (!open && $('command-console').contains(document.activeElement)) $('command-toggle').focus({ preventScroll: true });
}

function setTab(tab) {
  hideCardTooltip();
  if (tab !== activeTab && view.placement) { view.placement = null; view.deployUnitId = null; view.showGrid = false; setOrderHint(); }
  activeTab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    button.tabIndex = button.dataset.tab === tab ? 0 : -1;
  }
  $('catalog').setAttribute('aria-labelledby', `${tab}-tab`);
  $('catalog').dataset.category = tab;
  updateBuildingUpgrades();
  if (tab === 'research') { createResearchCatalog(); updateCatalog(); return; }
  $('catalog-tip').textContent = tab === 'build' ? 'Build within 7 tiles of a finished structure. Shift-click the ground to keep placing.' : 'Recruit into an available production queue. Shift-click or Shift + key recruits five.';
  $('catalog').replaceChildren();
  const defs = tab === 'build' ? BUILDINGS : UNITS;
  for (const [index, type] of (tab === 'build' ? buildTypes.map(role => raceBuilding(game, 0, role)) : unitTypes.map(role => raceUnit(game, 0, role))).entries()) {
    const def = defs[type], button = document.createElement('button');
    button.className = 'build-card'; button.dataset.type = type;
    button.setAttribute('aria-label', `${tab === 'build' ? 'Construct' : 'Recruit'} ${def.name}, ${def.cost} credits`);
    const icon = document.createElement('canvas'); icon.width = 128; icon.height = 112; icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'card-name'; name.textContent = def.name;
    const cost = document.createElement('span'); cost.className = 'card-price'; cost.textContent = `◈ ${def.cost}`;
    const meta = document.createElement('span'); meta.className = 'card-meta'; meta.textContent = cardMeta(def);
    const count = document.createElement('span'); count.className = 'card-queue-count'; count.hidden = true;
    const production = document.createElement('span'); production.className = 'card-production'; production.hidden = true;
    const hotkey = document.createElement('kbd'); hotkey.className = 'card-key'; hotkey.textContent = CARD_KEYS[index].toUpperCase(); hotkey.setAttribute('aria-hidden', 'true');
    button.append(icon, name, cost, meta, count, production, hotkey);
    button.setAttribute('aria-keyshortcuts', CARD_KEYS[index].toUpperCase());
    button.addEventListener('click', event => chooseProduction(type, event.pointerType === 'touch', event.shiftKey));
    button.setAttribute('aria-describedby', 'catalog-tip');
    button.addEventListener('focus', () => showCardTooltip(button)); button.addEventListener('blur', hideCardTooltip);
    $('catalog').append(button); drawIcon(icon, type, 0);
  }
  updateCatalog();
}

function updateCatalog(selected = selectedProducers()) {
  if (activeTab === 'research') { updateResearchCatalog(); return; }
  const buildings = [];
  let population = 0;
  for (const e of game.entities) if (e.team === 0 && e.hp > 0) {
    if (e.kind === 'unit') population++;
    else { buildings.push(e); population += e.queue.length + (e.haulerPending ? 1 : 0); }
  }
  const own = buildings.filter(e => e.progress >= 1);
  $('production-target').textContent = activeTab === 'build' ? 'Build within 7 tiles of a finished structure' : selected.length === 1 ? `Compatible units → ${BUILDINGS[selected[0].type].name} #${selected[0].id} · others auto-assign` : 'Automatic factory assignment';
  for (const button of $('catalog').children) {
    const type = button.dataset.type, def = (activeTab === 'build' ? BUILDINGS : UNITS)[type];
    const missing = (def.requires || []).filter(type => !own.some(e => buildingRole(e) === buildingRole(type)));
    let reason = missing.length ? `Requires ${missing.map(type => BUILDINGS[type]?.name || type).join(', ')}` : '';
    if (activeTab === 'train' && !own.some(e => e.type === def.producer)) reason ||= `Requires ${BUILDINGS[def.producer]?.name || def.producer}`;
    if (activeTab === 'train' && def.research && !game.teams[0].research?.[def.research]) reason ||= `Research ${RESEARCH[def.research]?.name || def.research}`;
    const producer = activeTab === 'train' ? chosenProducer(type, selected) : null;
    if (activeTab === 'train' && unitRole(type) === 'striker' && !(producer ? producer.upgrades?.advancedProduction : own.some(e => buildingRole(e) === 'factory' && e.upgrades?.advancedProduction))) reason ||= 'Requires Advanced assembly bay';
    const eligibleProducers = activeTab === 'train' ? own.filter(e => e.type === def.producer && (unitRole(type) !== 'striker' || e.upgrades?.advancedProduction)) : [];
    if (producer?.progress < 1) reason ||= 'Selected producer is under construction';
    if (activeTab === 'train' && (producer ? (producer.queue || []).length >= 6 : eligibleProducers.every(e => (e.queue || []).length >= 6))) reason ||= 'Production queues full';
    if ((activeTab === 'train' || buildingRole(type) === 'refinery') && population >= unitCapacity(game, 0)) reason ||= `Unit limit reached (${unitCapacity(game, 0)}) · deploy another nexus`;
    if (game.teams[0].credits < def.cost) reason ||= 'Insufficient credits';
    const previousReason = button.dataset.reason;
    button.dataset.reason = reason;
    button.querySelector('.card-meta').textContent = reason || cardMeta(def);
    button.setAttribute('aria-label', `${activeTab === 'build' ? 'Construct' : 'Recruit'} ${def.name}, ${def.cost} credits${reason ? `, ${reason}` : ''}`);
    button.disabled = !launched || paused || game.status !== 'playing' || Boolean(reason);
    // The floating tooltip replaces the browser's title text unless tooltips are switched off.
    button.title = settings.tooltips ? '' : [`${def.name} · ${def.cost} credits · ${def.buildTime || def.trainTime}s`, def.description, reason].filter(Boolean).join(' · ');
    if (tooltipCard === button && previousReason !== reason) showCardTooltip(button);
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

// Card details float beside the console: base combat figures from the armor table, the card's key and,
// for an unavailable card, the reason. Disabled cards cannot take focus, so hover is delegated.
let tooltipCard = null;
const armorList = classes => classes.map(armor => ARMOR_CLASSES[armor].toLowerCase()).join(', ');
function catalogTip(type, reason) {
  const def = BUILDINGS[type] || UNITS[type];
  return `${def.description || def.name}${reason ? ` · ${reason}` : ''}`;
}
function tooltipRows(card) {
  const rows = [], key = card.getAttribute('aria-keyshortcuts');
  if (card.dataset.research) {
    const id = card.dataset.research, def = RESEARCH[id];
    rows.push(['title', def.name], ['meta', `◈ ${def.cost} · ${def.time}s`], ['text', researchText(def)]);
    if (card.dataset.state === 'active') rows.push(['note', 'Researching · click to cancel for a full refund']);
    else if (card.dataset.reason) rows.push(['warn', card.dataset.reason]);
    if (key) rows.push(['key', `Key ${key}`]);
    return rows;
  }
  const type = card.dataset.type, stats = cardStats(type), def = BUILDINGS[type] || UNITS[type];
  rows.push(['title', def.name], ['meta', `◈ ${def.cost} · ${stats.time}s${stats.power ? ` · ${stats.power > 0 ? '+' : ''}${stats.power}ϟ` : ''}`], ['text', def.description]);
  const figures = [`${stats.hp} HP`, ARMOR_CLASSES[stats.armor]];
  if (stats.speed) figures.push(`speed ${Number(stats.speed.toFixed(2))}`);
  if (stats.dps) figures.unshift(`${Number(stats.dps.toFixed(1))} DPS`, `range ${stats.range}`);
  if (stats.splash) figures.push(`${stats.splash}-tile splash`);
  rows.push(['stats', figures.join(' · ')]);
  if (stats.strong.length) rows.push(['good', `Strong against ${armorList(stats.strong)}`]);
  if (stats.weak.length) rows.push(['bad', `Weak against ${armorList(stats.weak)}`]);
  if (abilityFor(type)) { const ability = ABILITIES[unitRole(type)]; rows.push(['text', `${ability.names[UNITS[type].race] ?? ability.names.organics} (F): ${ability.description}`]); }
  if (card.dataset.reason) rows.push(['warn', card.dataset.reason]);
  if (key) rows.push(['key', activeTab === 'train' ? `Key ${key} · Shift recruits five` : `Key ${key} · Shift keeps placing`]);
  return rows;
}
function showCardTooltip(card) {
  if (!card) return;
  if (card.dataset.type) $('catalog-tip').textContent = catalogTip(card.dataset.type, card.dataset.reason);
  if (!settings.tooltips || !game || $('command-console').hidden) { hideCardTooltip(); return; }
  const tip = $('card-tooltip');
  tip.replaceChildren(...tooltipRows(card).map(([kind, text]) => { const row = document.createElement(kind === 'title' ? 'strong' : 'span'); row.className = `tip-${kind}`; row.textContent = text; return row; }));
  tip.hidden = false; tooltipCard = card;
  // Beside the console when there is room, otherwise above the card.
  const box = card.getBoundingClientRect(), panel = $('command-console').getBoundingClientRect(), size = tip.getBoundingClientRect();
  let left = panel.left - size.width - 8, top = box.top;
  if (left < 8) { left = Math.min(Math.max(8, box.left), innerWidth - size.width - 8); top = box.top - size.height - 8; if (top < 56) top = box.bottom + 8; }
  tip.style.left = `${Math.round(left)}px`; tip.style.top = `${Math.round(Math.max(56, Math.min(top, innerHeight - size.height - 8)))}px`;
}
function hideCardTooltip() { tooltipCard = null; $('card-tooltip').hidden = true; }
$('catalog').addEventListener('pointerover', event => { const card = event.target.closest?.('.build-card, .research-card'); if (card && card !== tooltipCard && event.pointerType !== 'touch') showCardTooltip(card); });
$('catalog').addEventListener('pointerleave', hideCardTooltip);
$('catalog').addEventListener('pointerout', event => { if (tooltipCard && !tooltipCard.contains(event.relatedTarget)) hideCardTooltip(); });

function createResearchCatalog() {
  $('catalog').replaceChildren();
  $('catalog-tip').textContent = 'Each branch unlocks its next project. Upgrades apply to existing and future forces. Click an active project to cancel it for a full refund.';
  let index = 0;
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
      const hotkey = document.createElement('kbd'); hotkey.className = 'card-key'; hotkey.textContent = CARD_KEYS[index].toUpperCase(); hotkey.setAttribute('aria-hidden', 'true');
      button.setAttribute('aria-keyshortcuts', CARD_KEYS[index++].toUpperCase());
      button.append(badge, name, description, status, progress, hotkey);
      button.addEventListener('click', () => {
        if (busy()) return;
        const active = game.entities.find(e => e.team === 0 && e.hp > 0 && buildingRole(e) === 'lab' && e.research?.id === id);
        if (active) { cancelProject(active); return; }
        const lab = selectedEntities().find(e => buildingRole(e) === 'lab' && e.progress >= 1 && !e.research);
        const result = startResearch(game, 0, id, lab?.id);
        if (result.ok) { notify(`${def.name} research started.`); playSound('build'); }
        else notify(result.reason, 'warning');
        updateHUD();
      });
      button.addEventListener('focus', () => showCardTooltip(button)); button.addEventListener('blur', hideCardTooltip);
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
    // An active project stays clickable: clicking it cancels the project for a full refund.
    button.disabled = busy() || !(status.ok || status.queued);
    const label = status.completed ? '✓ Researched' : status.queued ? `Researching · ${Math.floor(progress * 100)}% · click to cancel` : status.ok ? `◈ ${def.cost} · ${def.time}s` : `${status.reason} · ◈ ${def.cost}`;
    button.querySelector('.research-state').textContent = label;
    button.querySelector('.research-tier').textContent = status.completed ? '✓' : status.queued ? '…' : (researchBranches.find(b => b.ids.includes(id)).ids.indexOf(id) + 1).toString().padStart(2, '0');
    button.title = settings.tooltips ? '' : `${def.name} · ${def.cost} credits · ${def.time}s. ${researchText(def)}${status.reason ? ` ${status.reason}` : ''}`;
    const changed = button.dataset.reason !== (status.queued ? '' : status.reason) || button.dataset.shown !== state;
    button.dataset.reason = status.queued ? '' : status.reason; button.dataset.shown = state;
    if (changed && tooltipCard === button) showCardTooltip(button);
    button.setAttribute('aria-label', `${def.name}. ${researchText(def)} ${label}`);
    const bar = button.querySelector('.research-progress'); bar.hidden = !status.queued;
    bar.firstElementChild.style.width = `${progress * 100}%`;
    if (status.queued) { bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', def.name); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(Math.floor(progress * 100))); }
  }
}

function updateBuildingUpgrades(selected = selectedEntities()) {
  const building = selected.length === 1 && selected[0].kind === 'building' ? selected[0] : null;
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
        if (result.ok) { notify(`${def.name} upgrade started.`); playSound('build'); } else notify(result.reason, 'warning');
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

function cancelProject(lab) {
  const name = RESEARCH[lab.research.id].name, result = cancelResearch(game, lab.id, 0);
  if (result.ok) { notify(`${name} research cancelled · +${fmt(result.refund)} credits`); playSound('cancel'); }
  else notify(result.reason, 'warning');
  updateHUD();
}
function cancelQueued(producerId, type) {
  if (busy()) return;
  const producer = getEntity(game, producerId);
  // The newest matching entry goes first, so a row of waiting units drains from the back.
  const index = type ? producer?.queue.findLastIndex(q => q.type === type) ?? -1 : 0;
  const result = cancelTraining(game, 0, producerId, index);
  if (!result.ok) notify(result.reason, 'warning'); else playSound('cancel');
  updateHUD();
}

function chooseProduction(type, touch = false, repeat = false) {
  if (busy()) return;
  if (activeTab === 'build') {
    view.deployUnitId = null;
    view.placement = view.placement === type ? null : type;
    view.showGrid = Boolean(view.placement); orderMode = null;
    setOrderHint(); updateCatalog(); playSound('select');
    if (view.placement) {
      if (touch || compactScreen.matches) { setConsole(false); canvas.focus({ preventScroll: true }); }
      notify(`Place ${BUILDINGS[type].name} within 7 tiles of a finished structure.`);
    }
  } else {
    // Shift queues five; it stops at the first refusal and reports how many were accepted.
    let queued = 0, reason = '';
    for (let i = 0; i < (repeat ? 5 : 1); i++) {
      const result = trainUnit(game, 0, type, chosenProducer(type)?.id);
      if (!result.ok) { reason = result.reason; break; }
      queued++;
    }
    if (queued) { notify(`${queued > 1 ? `${queued} × ` : ''}${UNITS[type].name} added to production${reason ? ` · ${reason}` : ''}.`); playSound('build'); }
    else notify(reason, 'warning');
    updateHUD();
  }
}
// A console key presses the card at that position on the open tab.
function pressCard(index, repeat) {
  if (busy()) return;
  if (activeTab === 'research') {
    const card = $('catalog').querySelectorAll('[data-research]')[index];
    if (!card) return;
    if (card.dataset.state === 'active') notify('Click an active project to cancel it.');
    else if (card.disabled) notify(card.dataset.reason || 'Unavailable', 'warning');
    else card.click();
    return;
  }
  const card = $('catalog').children[index];
  if (!card) return;
  if (card.disabled) { notify(card.dataset.reason || 'Unavailable', 'warning'); return; }
  chooseProduction(card.dataset.type, false, repeat);
}

function setOrderHint() {
  $('order-hint').hidden = !view.placement && !orderMode && !view.formationPreview;
  canvas.classList.toggle('ordering', Boolean(view.placement || orderMode || view.formationPreview));
  $('attack-order').classList.toggle('active', orderMode === 'attackMove');
  $('move-order').classList.toggle('active', orderMode === 'move');
  $('rally-order').classList.toggle('active', orderMode === 'rally');
  $('ability-order').classList.toggle('active', orderMode === 'ability');
  if (view.formationPreview) {
    $('order-hint-text').textContent = 'Formation move · Drag to rotate · Release to deploy · Esc to cancel';
    return;
  }
  if (view.placement === 'wall') {
    const plan = view.wallPlan;
    $('order-hint-text').textContent = `Wall line · ${plan?.count ?? 1} segments · ◈ ${plan?.cost ?? BUILDINGS.wall.cost}${plan?.reason ? ` · ${plan.reason}` : ' · Drag to build'}`;
    return;
  }
  if (orderMode === 'ability') {
    const group = abilityGroup(selectedUnits()), ability = group.length ? ABILITIES[unitRole(group[0])] : null, status = group.length ? abilityStatus(game, group[0]) : null;
    $('order-hint-text').textContent = status ? `${status.name} · Select a target within ${Number(status.range.toFixed(1))} tiles${ability.id === 'barrage' ? ' on explored ground' : ''} · Tactical map works too` : 'Ability · Select a target';
    return;
  }
  $('order-hint-text').textContent = view.placement ? `${view.deployUnitId ? 'Deploy' : 'Place'} ${BUILDINGS[view.placement].name} · ${view.placementReason || (view.deployUnitId ? 'Within 4 tiles of the vehicle · consumes vehicle' : 'Click to build · Shift keeps placing')}` : orderMode === 'rally' ? 'Rally point · Select a destination' : orderMode === 'attackMove' ? 'Attack move · Select a destination' : 'Move · Select a destination';
}

function cancelOrder() { cancelFormationGesture(); view.deployUnitId = null; view.placement = null; view.placementReason = ''; view.showGrid = false; view.wallStart = null; view.wallPlan = null; orderMode = null; abilityRole = null; view.drag = null; setOrderHint(); updateCatalog(); }
$('cancel-order').addEventListener('click', () => { cancelOrder(); canvas.focus({preventScroll:true}); });

function setOrder(type) {
  if (busy() || !(type === 'rally' ? selectedProducers() : type === 'ability' ? abilityGroup(selectedUnits()) : selectedUnits()).length) return;
  cancelFormationGesture();
  view.placement = null; view.deployUnitId = null; view.showGrid = false;
  orderMode = orderMode === type ? null : type;
  abilityRole = orderMode === 'ability' ? unitRole(abilityGroup(selectedUnits())[0]) : null;
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
  // Units get pointer priority when standing in front of a structure. Position is tested before
  // visibility so the hover readout does not scan every footprint on each refresh; units are hit
  // where they are drawn, which can trail the simulation by part of a tick.
  let building = null;
  for (const e of game.entities) {
    if (e.hp <= 0) continue;
    if (e.kind === 'unit') { const p = renderer.poseOf(e); if (Math.hypot(p.x - point.x, p.y - point.y) < .55 && isVisible(e)) return e; }
    else if (!building && point.x >= e.x && point.y >= e.y && point.x <= e.x + e.size && point.y <= e.y + e.size && isVisible(e)) building = e;
  }
  return building;
}

function selectAt(point, additive = false, touch = false) {
  const hit = entityAt(point);
  if (hit?.team === 0) {
    if (!additive) view.selected.clear();
    if (additive && view.selected.has(hit.id)) view.selected.delete(hit.id); else view.selected.add(hit.id);
    // The clicked unit answers; clicking it over and over earns a weary reply.
    if (hit.kind === 'unit' && view.selected.has(hit.id)) acknowledge('select', 'select', [hit]); else playSound('select');
    updateHUD();
  } else if (touch && (selectedUnits().length || selectedProducers().length)) commandAt(point);
  else if (!additive) { view.selected.clear(); updateHUD(); }
}

function commandAt(point, explicitType) {
  const units = selectedUnits();
  const x = Math.max(.5, Math.min(game.width - .5, point.x)), y = Math.max(.5, Math.min(game.height - .5, point.y));
  const producers = selectedProducers();
  if (explicitType === 'rally' || (!units.length && producers.length)) {
    const result = setRallyPoint(game, 0, producers.map(e => e.id), { x, y });
    if (!result.ok) { notify(result.reason, 'warning'); return; }
    view.commandMarker = { x, y, time: performance.now() / 1000, type: 'rally' };
    orderMode = null; setOrderHint(); updateHUD(); playSound('rally');
    notify(`Rally point set for ${producers.length === 1 ? BUILDINGS[producers[0].type].name : `${producers.length} producers`}.`);
    return;
  }
  if (!units.length) return;
  if (explicitType === 'ability') {
    // The click belongs to the ability targeting began with; a selection that has since changed to
    // another ability leaves targeting instead of spending that one.
    const group = abilityGroup(units);
    if (!group.length || unitRole(group[0]) !== abilityRole) { cancelOrder(); return; }
    const result = useAbility(game, 0, group.map(e => e.id), { x, y });
    // A refused target keeps the targeting mode so the next click can correct it.
    if (!result.ok) { notify(result.reason, 'warning'); return; }
    view.commandMarker = { x, y, time: performance.now() / 1000, type: 'ability' };
    // The ability event brings its own cue and the unit's reply (soundscape), so the click adds none.
    orderMode = null; setOrderHint(); updateHUD();
    return;
  }
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
  view.commandMarker = { x, y, time: performance.now() / 1000, type, ...(type === 'attack' ? { targetId: hit.id } : {}) };
  orderMode = null; setOrderHint();
  acknowledge(type, type === 'attack' || type === 'attackMove' ? 'attackOrder' : type === 'harvest' ? 'harvestOrder' : 'order', type === 'harvest' ? units.filter(e => unitRole(e) === 'harvester') : units);
  updateHUD();
}

function placeAt(point, repeat = false) {
  if (!view.placement) return;
  const type = view.placement, deploying = Boolean(view.deployUnitId);
  const result = deploying ? deployNexus(game, 0, view.deployUnitId, Math.floor(point.x), Math.floor(point.y)) : placeBuilding(game, 0, type, Math.floor(point.x), Math.floor(point.y));
  if (result.ok && deploying) view.selected = new Set([result.id]);
  if (!result.ok) { notify(result.reason, 'warning'); return; }
  // Shift keeps the same structure in hand for the next site.
  if (repeat && !deploying) { notify(`${BUILDINGS[type].name} construction started · Shift keeps placing.`); playSound('build'); updateHUD(); return; }
  cancelOrder(); notify(`${BUILDINGS[type].name} construction started.`); playSound('build'); updateHUD();
}

function updateHUD() {
  $('credits').textContent = fmt(game.teams[0].credits);
  const power = powerStats(game, 0);
  const low = power.ratio < 1;
  // Quiet: the brownout's power event already sounds its stinger.
  if (low !== lowPower) { lowPower = low; if (low && game.status === 'playing' && !paused) notify(`Low power: defenses offline and production slowed. Build ${BUILDINGS[raceBuilding(game, 0, 'reactor')].name}.`, 'warning', { quiet: true }); }
  $('power').textContent = `${Math.floor(power.supply)} / ${Math.ceil(power.demand)}`;
  $('power-resource').classList.toggle('low-power', low);
  $('power-resource').classList.toggle('reserve-power', power.usingReserve);
  const powerDetail = low ? `Brownout: ${Math.round(power.ratio * 100)}% power. Production, research, mineral processing and repairs slow; defenses are offline.` : power.usingReserve ? `Reserve power: ${Math.ceil(power.reserveSeconds)} seconds remaining. Build a reactor before storage runs out.` : `Grid stable. ${Math.round(power.supply - power.demand)} spare power · +${Math.round((power.productionMultiplier - 1) * 100)}% construction and production speed. Diminishing returns, up to +25%.`;
  const powerDescription = `Power generated: ${Math.floor(power.supply)}. Power needed: ${Math.ceil(power.demand)}. ${powerDetail}`;
  $('power-resource').title = powerDescription;
  $('power-resource').setAttribute('aria-label', powerDescription);
  $('grid-summary').textContent = low ? 'Brownout' : power.usingReserve ? 'Reserve active' : 'Grid stable';
  $('grid-state').dataset.state = power.status;
  $('grid-rate').textContent = `${Math.round(power.ratio * power.productionMultiplier * 100)}%`;
  $('grid-output').style.width = `${power.ratio * 100}%`;
  $('grid-detail').textContent = low ? 'Defenses offline · industry slowed' : power.usingReserve ? `${Math.ceil(power.reserveSeconds)}s of reserve · restore supply` : `Industry +${Math.round((power.productionMultiplier - 1) * 100)}% · diminishing returns`;
  $('reserve-meter').hidden = !power.reserveCapacity;
  $('reserve-fill').style.width = `${power.reserveCapacity ? power.reserve / power.reserveCapacity * 100 : 0}%`;
  $('reserve-label').textContent = `Storage ${Math.round(power.reserve || 0)} / ${power.reserveCapacity || 0}`;
  $('grid-state').title = powerDetail;
  // One pass over the entities feeds the counters and the selection. Pruning by lookup keeps a large
  // selection from costing selected × entities work on every refresh.
  const owned = new Map();
  let deployed = 0, reserved = 0, nexuses = 0;
  for (const e of game.entities) {
    if (e.team !== 0 || e.hp <= 0) continue;
    owned.set(e.id, e);
    if (e.kind === 'unit') deployed++;
    else { reserved += e.queue.length + (e.haulerPending ? 1 : 0); if (buildingRole(e) === 'core' && e.progress >= 1) nexuses++; }
  }
  const capacity = unitCapacity(game, 0);
  $('army').textContent = `${deployed} / ${capacity}`;
  $('army').closest('.resource').title = `${deployed} deployed · ${reserved} reserved · ${nexuses} completed nexuses × ${UNIT_CAP_PER_NEXUS} slots · maximum ${UNIT_CAP}. Deploy another nexus to expand capacity.`;
  $('mission-time').textContent = minutes(game.time);
  for (const id of view.selected) if (!owned.has(id)) view.selected.delete(id);
  if (heldPromotions.size) releaseHeldPromotions();
  let selection = game.entities.filter(e => e.team === 0 && e.hp > 0 && view.selected.has(e.id));
  if (selection.some(e => e.kind === 'unit' && UNITS[e.type].damage > 0)) {
    for (const e of selection) if (unitRole(e) === 'harvester') view.selected.delete(e.id);
    selection = selection.filter(e => unitRole(e) !== 'harvester');
  }
  const units = selection.filter(e => e.kind === 'unit'), producers = selection.filter(isProducer);
  const first = selection[0];
  const panel = $('selection-panel');
  if (!first && !panel.hidden && panel.contains(document.activeElement)) canvas.focus({ preventScroll: true });
  panel.hidden = !first;
  $('deselect').hidden = !view.selected.size;
  document.body.dataset.selection = String(Boolean(first));
  $('selection-label').textContent = first ? selection.length > 1 ? 'Battle group' : first.kind === 'building' ? 'Structure' : 'Unit' : 'Command network';
  $('selection-name').textContent = first ? selection.length > 1 ? `${selection.length} units selected` : (BUILDINGS[first.type] || UNITS[first.type]).name : 'Expedition standing by';
  const sign = selection.length === 1 && first.kind === 'unit' ? callsign(game, first) : '';
  $('selection-callsign').textContent = sign; $('selection-callsign').hidden = !sign;
  let detail = 'Select a unit or structure to issue orders.';
  if (first) {
    if (selection.length > 1) {
      const counts = new Map();
      selection.forEach(e => counts.set(e.type, (counts.get(e.type) || 0) + 1));
      const exploring = units.filter(e => e.order?.type === 'explore').length;
      detail = `${exploring ? `${exploring} auto-exploring · ` : ''}${[...counts].map(([type, n]) => `${n} ${(UNITS[type] || BUILDINGS[type]).name}`).join(' · ')}`;
    } else if (first.kind === 'building') detail = first.progress < 1 ? `Under construction · ${Math.floor(first.progress * 100)}% · ${seconds(BUILDINGS[first.type].buildTime * (1 - first.progress) / (Math.max(.2, power.ratio) * power.productionMultiplier))}` : `${Math.ceil(first.hp)} / ${first.maxHp} integrity · ${buildingActivity(first, power).join(' · ')}`;
    else if (unitRole(first) === 'harvester') {
      const cargo = (first.cargo || 0) * (first.unloadDepotId ? Math.max(0, 1 - (first.unload || 0) / 1.2) : 1);
      detail = `${cargo < 1 ? 'Empty' : cargo >= UNITS[first.type].capacity ? 'Full' : `Cargo ${Math.ceil(cargo)} / ${UNITS[first.type].capacity}`} · ${first.unloadDepotId ? 'Unloading minerals' : first.order?.type === 'explore' ? 'Auto-exploring' : first.order?.type === 'move' ? 'Relocating · auto-harvest next' : first.harvestPhase === 'return' ? 'Returning cargo' : 'Auto-harvesting'}`;
    }
    else detail = `${Math.ceil(first.hp)} / ${first.maxHp} integrity · ${first.order?.type === 'explore' ? `Auto-exploring${first.targetId ? ' · Engaging' : ''}` : first.order?.type === 'move' ? 'Moving' : unitRole(first) === 'constructor' ? `Ready to deploy · +${UNIT_CAP_PER_NEXUS} slots` : unitRole(first) === 'engineer' ? first.repairTargetId ? 'Repairing nearby machinery' : 'Auto-repair within 4 tiles' : first.targetId || first.order?.type === 'attack' ? 'Engaging' : first.order?.type === 'attackMove' ? 'Advancing' : first.stance === 'defend' ? 'Defending' : 'Guarding'}`;
    if (producers.length) detail += first.rally ? ` · Rally ${Math.floor(first.rally.x)}:${Math.floor(first.rally.y)}` : ' · Set rally with R or right click';
  }
  if (selection.length === 1 && first.kind === 'unit' && terrainCover(game, first) > 0) detail += ' · 15% crater cover';
  if (selection.length === 1 && first.controlGroup) detail += ` · Group ${first.controlGroup}`;
  $('selection-detail').textContent = detail;
  const rankedUnit = selection.length === 1 && first.kind === 'unit' ? first : null;
  const rankInfo = $('selection-rank'); rankInfo.hidden = !rankedUnit;
  if (rankedUnit) {
    const rank = unitRank(rankedUnit), kills = rankedUnit.kills || 0, stats = unitStats(rankedUnit);
    const next = rank < 3 ? (rank + 1) * 5 : null, bonus = rank * 20;
    rankInfo.dataset.rank = rank; rankInfo.dataset.kills = kills;
    // Damage and HP share the large bonus; speed gets its own, smaller figure. A narrow panel keeps the
    // line whole by stepping down to shorter forms: the speed figure goes to the tooltip first, then the
    // wording tightens, and as a last resort the bonus wraps onto a second line, so it always says what
    // it applies to. Rebuilt only when the figures or the panel width change, or a late font swap makes
    // the chosen form overflow.
    const width = rankInfo.clientWidth, key = `${rank}:${kills}:${width}`;
    const tally = `${kills}${next ? `/${next}` : ''}`, damage = ` · +${bonus}% dmg/HP`;
    const forms = [
      [`Rank ${rank}/3 · ${tally} kills`, damage, ` · +${rank * 5}% spd`],
      [`Rank ${rank}/3 · ${tally} kills`, damage],
      [`R${rank} · ${tally} kills`, damage],
      [`R${rank} · ${tally}`, damage],
      [`R${rank} · ${tally} kills`, damage],
    ];
    const last = forms.length - 1;
    if (rankInfo.dataset.layout !== key || (rankInfo.scrollWidth > width && rankInfo.dataset.form !== String(last))) {
      const part = (className, text) => { const span = document.createElement('span'); span.className = className; span.textContent = text; return span; };
      for (const [index, [tallyText, damageText, speedText]] of forms.entries()) {
        rankInfo.classList.toggle('wrap', index === last);
        rankInfo.replaceChildren(part('rank-kills', tallyText), part('rank-damage', damageText), ...(speedText ? [part('rank-speed', speedText)] : []));
        rankInfo.dataset.form = index;
        if (index === last || rankInfo.scrollWidth <= width) break;
      }
      rankInfo.dataset.layout = key;
    }
    const summary = `Rank ${rank} of 3. ${kills} kills. ${next ? `${next - kills} kills to next rank.` : 'Maximum rank.'} +${bonus}% damage and maximum HP, +${rank * 5}% speed. Damage ${Number(stats.damage.toFixed(2))}, speed ${Number(stats.speed.toFixed(2))} tiles/second, maximum HP ${stats.hp}.`;
    rankInfo.title = summary; rankInfo.setAttribute('aria-label', summary);
  } else {
    rankInfo.textContent = ''; rankInfo.removeAttribute('title'); rankInfo.removeAttribute('aria-label'); rankInfo.classList.remove('wrap');
    delete rankInfo.dataset.rank; delete rankInfo.dataset.kills; delete rankInfo.dataset.layout; delete rankInfo.dataset.form;
  }
  $('selected-count').textContent = first ? `${selection.length}`.padStart(2, '0') : '07';
  $('selection-health').hidden = selection.length !== 1;
  if (first) $('selection-health').firstElementChild.style.width = `${Math.max(0, first.hp / first.maxHp * 100)}%`;
  const portraitKey = first ? `${first.id}:${first.type}:${Math.floor(first.progress * 10)}:${first.queue?.[0]?.type}:${Math.floor((first.queue?.[0]?.progress || 0) * 10)}:${Math.ceil((first.processingAmount || 0) / 50)}:${first.processingType}:${first.cargoType}:${Math.ceil((first.cargo || 0) * (first.unloadDepotId ? Math.max(0, 1 - (first.unload || 0) / 1.2) : 1) / 50)}:${Math.round(power.ratio * 20)}:${power.status}:${Math.round((first.research?.progress || 0) * 10)}:${Math.round((first.reserve || 0) / 100)}:${Math.round((first.upgrade?.progress || 0) * 10)}` : 'core';
  if (portraitKey !== lastPortrait) { drawIcon($('portrait'), first?.type || raceBuilding(game, 0, 'core'), 0, { ...first, powerRatio: power.ratio, powerStatus: power.status }); lastPortrait = portraitKey; }
  for (const id of ['move-order', 'attack-order', 'explore-order', 'stop-order']) { $(id).disabled = busy() || !units.length; $(id).hidden = !units.length; }
  updateAbilityButton(abilityGroup(units));
  // A pending destination order needs something left to command.
  if (((orderMode === 'attackMove' || orderMode === 'move') && !units.length) || (orderMode === 'rally' && !producers.length)) cancelOrder();
  const military = units.filter(unit => UNITS[unit.type].damage > 0);
  $('unit-stance').hidden = !military.length;
  const preferredDefend = military.filter(unit => unit.stance === 'defend').length;
  const defending = military.filter(unit => effectiveUnitStance(unit) === 'defend').length;
  const commanded = military.some(unit => unit.order?.type !== 'idle');
  for (const stance of ['guard', 'defend']) {
    const button = $(`stance-${stance}`), count = stance === 'defend' ? preferredDefend : military.length - preferredDefend;
    button.disabled = busy() || !military.length;
    button.setAttribute('aria-pressed', count ? count === military.length ? 'true' : 'mixed' : 'false');
    button.classList.toggle('active', count > 0);
  }
  $('stance-status').textContent = !preferredDefend ? commanded ? 'Guard · command active' : 'Guard · hold position' : preferredDefend === military.length
    ? defending === military.length ? 'Defend · retaliate nearby' : !defending ? 'Guard now · Defend when idle' : `${defending} Defend · ${military.length - defending} Guard until idle`
    : !defending ? 'Guard now · mixed idle stances' : `${defending} Defend · ${military.length - defending} Guard`;
  const constructor = selection.length === 1 && first?.kind === 'unit' && unitRole(first) === 'constructor' ? first : null;
  $('deploy-nexus').hidden = !constructor;
  $('deploy-nexus').disabled = busy() || !constructor;
  if (constructor) $('deploy-nexus').title = `Deploy ${BUILDINGS[raceBuilding(game, 0, 'core')].name} within 4 tiles · consumes this vehicle · 40s construction · +${UNIT_CAP_PER_NEXUS} unit slots`;
  $('rally-order').hidden = !producers.length;
  $('rally-order').disabled = busy() || !producers.length;
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
  updateQueueList();
  updateIdleButtons();
  updateBuildingUpgrades(selection); updateCatalog(producers);
  updateHoverReadout();
  document.body.style.setProperty('--selection-height', panel.hidden ? '0px' : `${panel.getBoundingClientRect().height}px`);
  document.body.style.setProperty('--map-height', `${tacticalMap.offsetHeight}px`);
  const hint = $('order-hint');
  document.body.style.setProperty('--order-hint-height', hint.hidden ? '0px' : `${hint.getBoundingClientRect().height}px`);
}

// What a single completed structure is doing, at the rates the simulation actually applies.
function buildingActivity(e, power) {
  const role = buildingRole(e), d = BUILDINGS[e.type], job = e.queue?.[0];
  const pace = productionRate(game, 0, power) * (e.upgrades?.speed ? 1.25 : 1), activity = [];
  if (e.research) activity.push(`${RESEARCH[e.research.id].name} ${Math.floor(e.research.progress * 100)}% · ${seconds(RESEARCH[e.research.id].time * (1 - e.research.progress) / pace)}`);
  else if (job) activity.push(`${UNITS[job.type].name} ${Math.floor(job.progress * 100)}% · ${seconds(UNITS[job.type].trainTime * (1 - job.progress) / pace)}${e.queue.length > 1 ? ` · ${e.queue.length - 1} queued` : ''}`);
  else if (isProducer(e) && role !== 'refinery') activity.push('Idle · bay empty');
  else if (role === 'lab') activity.push('Idle · choose a research project');
  if (role === 'capacitor') activity.push(`${Math.round(e.reserve || 0)} stored · ${power.usingReserve && e.reserve > 0 ? 'Reserve available' : e.reserve >= d.reserveCapacity ? 'Fully charged' : power.supply > power.demand ? `Charging ${Math.round(capacitorCharge(e, power))}/s` : 'Waiting for spare power'}`);
  if (d.power > 0) activity.push(`+${d.power} power`);
  if (d.damage) activity.push(power.ratio >= 1 ? `${Number((d.damage / d.interval).toFixed(1))} DPS · range ${d.range}` : 'Offline · needs power');
  if (e.processingAmount > 0) activity.push(`Processing ${Math.round(UNITS.harvester.capacity / 6 * power.ratio * power.productionMultiplier * (e.upgrades?.speed ? 1.25 : 1))} shards/s · ${Math.ceil(e.processingAmount)} remaining`);
  else if (role === 'refinery') activity.push('Awaiting deliveries');
  if ((job || e.research) && Math.abs(pace - 1) > .005) activity.push(`${Math.round(pace * 100)}% rate`);
  if (e.upgrade) activity.push(`${BUILDING_UPGRADES[e.upgrade.id].name} ${Math.floor(e.upgrade.progress * 100)}% · ${seconds(BUILDING_UPGRADES[e.upgrade.id].time * (1 - e.upgrade.progress) / productionRate(game, 0, power))}`);
  if (lowPower && d.power < 0) activity.unshift('Brownout');
  if (e.haulerPending) activity.push('Included hauler awaiting deployment');
  if (e.repairing) activity.unshift(game.teams[0].credits > 0 ? 'Repairing' : 'Repair waiting for credits');
  return activity.length ? activity : ['Operational'];
}

// Surplus fills capacitors in entity order at up to 30 per second each, as the simulation charges them.
function capacitorCharge(capacitor, power) {
  let surplus = Math.max(0, power.supply - power.demand);
  for (const e of game.entities) {
    if (e.team !== 0 || e.hp <= 0 || e.progress < 1 || buildingRole(e) !== 'capacitor') continue;
    const rate = (e.reserve || 0) >= BUILDINGS[e.type].reserveCapacity ? 0 : Math.min(30, surplus);
    if (e === capacitor) return rate;
    surplus -= rate;
  }
  return 0;
}

// Production rows: clicking a row cancels the unit in training, a waiting chip cancels the newest unit
// of that type, and a research row cancels the project, each for a full refund. Rows are rebuilt only
// when their contents change, so a click is never lost to a progress refresh.
function updateQueueList() {
  const queue = []; let queueCount = 0;
  for (const e of game.entities) if (e.team === 0 && e.kind === 'building' && e.hp > 0) {
    if (e.progress < 1) { queue.push({ key: `c${e.id}`, name: BUILDINGS[e.type].name, progress: e.progress, label: 'Construction' }); queueCount++; }
    if (e.queue?.length) {
      queueCount += e.queue.length;
      const waiting = new Map();
      for (const q of e.queue.slice(1)) waiting.set(q.type, (waiting.get(q.type) || 0) + 1);
      queue.push({ key: `t${e.id}`, producer: e.id, type: e.queue[0].type, name: UNITS[e.queue[0].type].name, progress: e.queue[0].progress || 0, label: `${BUILDINGS[e.type].name} #${e.id}`, waiting: [...waiting] });
    }
    if (e.research) { queueCount++; queue.push({ key: `r${e.id}`, lab: e.id, name: RESEARCH[e.research.id].name, progress: e.research.progress, label: `Research · lab #${e.id}` }); }
    if (e.upgrade) { queueCount++; queue.push({ key: `u${e.id}`, name: BUILDING_UPGRADES[e.upgrade.id].name, progress: e.upgrade.progress, label: `Upgrade · ${BUILDINGS[e.type].name}` }); }
  }
  $('queue-count').textContent = String(queueCount).padStart(2, '0');
  $('pending-count').hidden = !queueCount;
  $('pending-count').textContent = queueCount;
  $('pending-count').setAttribute('aria-label', `${queueCount} in production`);
  const queueKey = queue.map(q => `${q.key}:${q.name}:${q.label}:${(q.waiting || []).map(([type, n]) => `${type}x${n}`).join(',')}`).join('|');
  const list = $('queue-list');
  if (queueKey !== lastQueue) {
    list.replaceChildren();
    if (!queue.length) { const p = document.createElement('p'); p.textContent = 'Production idle'; list.append(p); }
    for (const item of queue) {
      const row = document.createElement('div'); row.className = 'queue-item'; row.dataset.key = item.key;
      const cancellable = item.producer || item.lab;
      const main = document.createElement(cancellable ? 'button' : 'div'); main.className = 'queue-main';
      const name = document.createElement('b'); name.textContent = item.name;
      const label = document.createElement('small'); label.textContent = item.label; name.append(label);
      const percent = document.createElement('span'); percent.className = 'queue-percent';
      main.append(name, percent);
      if (item.producer) {
        main.addEventListener('click', () => cancelQueued(item.producer));
        main.setAttribute('aria-label', `Cancel ${item.name} at ${item.label} for a ${fmt(UNITS[item.type].cost)} credit refund`);
        main.title = `Cancel ${item.name} · refund ${fmt(UNITS[item.type].cost)} credits`;
      } else if (item.lab) {
        main.addEventListener('click', () => { const lab = getEntity(game, item.lab); if (!busy() && lab?.research) cancelProject(lab); });
        main.setAttribute('aria-label', `Cancel ${item.name} research for a full refund`);
        main.title = `Cancel ${item.name} research · full refund`;
      }
      row.append(main);
      if (item.waiting?.length) {
        const chips = document.createElement('div'); chips.className = 'queue-waiting';
        for (const [type, count] of item.waiting) {
          const chip = document.createElement('button'); chip.className = 'queue-chip';
          chip.textContent = `${UNITS[type].name} ×${count}`;
          chip.title = `Cancel one waiting ${UNITS[type].name} · refund ${fmt(UNITS[type].cost)} credits`;
          chip.setAttribute('aria-label', `Cancel one of ${count} waiting ${UNITS[type].name} at ${item.label}`);
          chip.addEventListener('click', () => cancelQueued(item.producer, type));
          chips.append(chip);
        }
        row.append(chips);
      }
      const bar = document.createElement('i'); bar.className = 'queue-bar'; row.append(bar);
      list.append(row);
    }
    lastQueue = queueKey;
  }
  for (const item of queue) {
    const row = list.querySelector(`[data-key="${item.key}"]`);
    if (!row) continue;
    row.querySelector('.queue-percent').textContent = `${Math.floor(item.progress * 100)}%`;
    row.querySelector('.queue-bar').style.width = `${Math.floor(item.progress * 100)}%`;
    if (item.producer || item.lab) row.querySelector('.queue-main').disabled = busy();
    for (const chip of row.querySelectorAll('.queue-chip')) chip.disabled = busy();
  }
}

function updateIdleButtons() {
  // Idle forces change slowly; a few refreshes per second keep large armies cheap.
  const now = performance.now();
  if (now - idleCheckedAt > 450) { idle = idleSummary(game); idleCheckedAt = now; }
  const units = idle.constructors.length + idle.engineers.length + idle.combat.length, production = idle.producers.length + idle.labs.length;
  const unitsText = units ? `${units} idle: ${[[idle.constructors.length, 'construction'], [idle.engineers.length, 'engineering'], [idle.combat.length, 'armed away from base']].filter(([n]) => n).map(([n, label]) => `${n} ${label}`).join(', ')}. Next idle unit · Period; Shift selects the armed units away from base` : 'No idle units';
  const productionText = production ? `${production} idle: ${[[idle.producers.length, 'production bay'], [idle.labs.length, 'laboratory']].filter(([n]) => n).map(([n, label]) => `${n} ${n === 1 ? label : label === 'laboratory' ? 'laboratories' : `${label}s`}`).join(', ')}. Next · Comma` : 'No idle production';
  for (const [id, count, text] of [['idle-units', units, unitsText], ['idle-production', production, productionText]]) {
    const button = $(id);
    button.querySelector('.idle-count').textContent = count;
    button.dataset.empty = String(!count); button.title = text; button.setAttribute('aria-label', text);
    button.disabled = busy();
  }
}
function cycleIdle(group, all = false) {
  if (busy()) return;
  idle = idleSummary(game); idleCheckedAt = performance.now();
  const list = group === 'units' ? [...idle.constructors, ...idle.engineers, ...idle.combat] : [...idle.producers, ...idle.labs];
  // Shift + . gathers only the armed units waiting away from the base; it never falls back to workers.
  if (all && group === 'units' && !idle.combat.length) { notify('No idle armed units away from base.'); return; }
  if (!list.length) { notify(group === 'units' ? 'No idle units.' : 'No idle production.'); return; }
  cancelOrder();
  if (all && group === 'units') {
    view.selected = new Set(idle.combat.map(e => e.id)); centerOnSelection(); acknowledge('select', 'select', idle.combat);
  } else {
    const next = list[(list.findIndex(e => e.id === idleCursor[group]) + 1) % list.length];
    idleCursor[group] = next.id;
    view.selected = new Set([next.id]); centerOn(entityCenter(next));
    if (next.kind === 'unit') acknowledge('select', 'select', [next]);
    else { playSound('select'); if (!$('command-console').hidden) setTab(buildingRole(next) === 'lab' ? 'research' : 'train'); }
  }
  updateHUD();
}

// The largest group of units sharing an ability acts for a mixed selection.
function abilityGroup(units) {
  const groups = new Map(), order = Object.keys(ABILITIES);
  for (const u of units) if (abilityFor(u)) { const role = unitRole(u); if (!groups.has(role)) groups.set(role, []); groups.get(role).push(u); }
  return [...groups].sort(([a, x], [b, y]) => y.length - x.length || order.indexOf(a) - order.indexOf(b))[0]?.[1] ?? [];
}
function updateAbilityButton(group) {
  const button = $('ability-order');
  button.hidden = !group.length;
  // Targeting follows the selection: another ability (or none) leaves it, and the hint tracks the
  // reach of the units now selected.
  if (orderMode === 'ability') {
    if (!group.length || unitRole(group[0]) !== abilityRole || ABILITIES[abilityRole]?.target !== 'ground') cancelOrder();
    else setOrderHint();
  }
  if (!group.length) return;
  const ability = ABILITIES[unitRole(group[0])], statuses = group.map(u => abilityStatus(game, u));
  const ready = statuses.filter(status => status.ready).length, active = statuses.some(status => status.active);
  const remaining = Math.min(...statuses.map(status => status.remaining)), name = statuses[0].name;
  const reason = ready ? '' : `${active ? `${name} active · ` : ''}Recharging · ${seconds(remaining)}`;
  // The countdown replaces the icon, so the button keeps its width (and the panel its layout) as it ticks.
  $('ability-label').textContent = ready && group.length > 1 ? `${name} ×${ready}` : name;
  button.firstElementChild.textContent = ready ? '✦' : String(Math.ceil(remaining));
  $('ability-reason').textContent = reason;
  button.style.setProperty('--cooldown', ready ? '0' : String(Math.min(1, remaining / ability.cooldown)));
  button.disabled = busy();
  button.setAttribute('aria-disabled', String(!ready));
  button.classList.toggle('recharging', !ready);
  const description = `${name}: ${ability.description}${ready ? ` ${ready} of ${group.length} ready.` : ` ${reason}.`} Press F${ability.target === 'ground' ? ', then choose a target' : ''}.`;
  button.title = description; button.setAttribute('aria-label', `${name} · F`);
}
function triggerAbility() {
  if (busy()) return;
  const group = abilityGroup(selectedUnits());
  if (!group.length) return;
  const statuses = group.map(u => abilityStatus(game, u));
  if (!statuses.some(status => status.ready)) { notify(`${statuses[0].name} recharging · ${seconds(Math.min(...statuses.map(status => status.remaining)))}`, 'warning'); return; }
  if (ABILITIES[unitRole(group[0])].target === 'ground') { setOrder('ability'); return; }
  const result = useAbility(game, 0, group.map(u => u.id));
  if (!result.ok) { notify(result.reason, 'warning'); return; }
  // The ability event brings its own cue and the unit's reply (soundscape), so the key adds none.
  cancelOrder(); updateHUD();
}
// Ground abilities preview each ready unit's reach and the area the click would cover.
function drawAbilityPreview() {
  if (orderMode !== 'ability') return;
  const group = abilityGroup(selectedUnits());
  if (!group.length) return;
  const ability = ABILITIES[unitRole(group[0])], ctx = renderer.ctx;
  let reachable = false;
  ctx.save(); ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0); ctx.lineWidth = 1.2; ctx.setLineDash([6, 6]);
  let drawn = 0;
  for (const u of group) {
    const status = abilityStatus(game, u);
    if (!status?.ready) continue;
    if (view.hover && Math.hypot(view.hover.x - u.x, view.hover.y - u.y) <= status.range) reachable = true;
    // A large battery shows a dozen reach rings; more would only bury the target under outlines.
    if (drawn++ >= 12) continue;
    const p = renderer.worldToScreen(u.x, u.y, view);
    ctx.strokeStyle = '#d9a76490'; ctx.beginPath(); ctx.arc(p.x, p.y, status.range * view.zoom, 0, Math.PI * 2); ctx.stroke();
  }
  if (view.hover) {
    const { x, y } = view.hover, inside = x >= 0 && y >= 0 && x < game.width && y < game.height;
    const valid = reachable && inside && (ability.id !== 'barrage' || game.explored[0][Math.floor(y) * game.width + Math.floor(x)]);
    const p = renderer.worldToScreen(x, y, view), radius = (ability.radius ?? ability.scatter + ability.splash) * view.zoom;
    ctx.setLineDash([]); ctx.strokeStyle = valid ? '#d9a764' : '#e29677'; ctx.fillStyle = valid ? '#d9a7641a' : '#e2967714';
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.beginPath(); ctx.moveTo(p.x + dx * 4, p.y + dy * 4); ctx.lineTo(p.x + dx * 10, p.y + dy * 10); ctx.stroke(); }
  }
  ctx.restore();
}

// A line about the entity under the pointer: friendly callsigns, or what the player can see of an enemy.
function updateHoverReadout() {
  const hover = view.hover, at = hover ? Math.floor(hover.y) * game.width + Math.floor(hover.x) : -1;
  const known = hover && hover.x >= 0 && hover.y >= 0 && hover.x < game.width && hover.y < game.height && game.explored[0][at];
  let groundHint = '';
  if (known) {
    const ore = game.visible[0][at] ? game.minerals[at] : renderer.knownOre?.[at];
    if (ore > 0) { const type = renderer.knownMineralTypes?.[at] || game.mineralTypes[at] || 1; groundHint = `${['', 'Mint shards', 'Blue shards', 'Red shards · 2× density'][type]} · ${fmt(ore)} credits`; }
    else groundHint = ({1:'Raised ridge · impassable', 3:'Molten lava · impassable', 4:'Twisted roots · obstructed', 5:'Crater · 15% direct-fire cover · no construction'})[game.terrain[at]] || '';
  }
  const entity = known && settings.tooltips && !view.placement && !orderMode ? entityAt(hover) : null;
  let entityHint = '';
  if (entity?.team === 0) entityHint = entity.kind === 'unit'
    ? `${callsign(game, entity)} · ${UNITS[entity.type].name} · ${Math.ceil(entity.hp)} / ${Math.round(entity.maxHp)} HP · Rank ${unitRank(entity)}/3`
    : `${BUILDINGS[entity.type].name} · ${entity.progress < 1 ? `${Math.floor(entity.progress * 100)}% built` : `${Math.ceil(entity.hp)} / ${entity.maxHp} integrity`}`;
  // An enemy's exact maximum HP would reveal its research, so only the visible health fraction shows.
  else if (entity) entityHint = `Hostile ${entity.kind === 'unit' ? `${callsign(game, entity)} · ${UNITS[entity.type].name}` : BUILDINGS[entity.type].name} · ${Math.max(1, Math.round(entity.hp / entity.maxHp * 100))}% integrity${entity.kind === 'unit' ? ` · Rank ${unitRank(entity)}/3` : ''}`;
  const readout = $('terrain-readout'), text = [entityHint, groundHint].filter(Boolean).join('\n');
  if (readout.textContent !== text) readout.textContent = text;
  readout.dataset.team = entity ? String(entity.team) : '';
  readout.hidden = !text || Boolean(view.placement);
  placeReadout();
}
// The readout rides beside the pointer, flipping at the battlefield edges so it never leaves the screen
// or slides under the topbar.
const readoutTop = 56;
function placeReadout() {
  const readout = $('terrain-readout');
  if (readout.hidden || !pointerPosition) return;
  const width = readout.offsetWidth, height = readout.offsetHeight, sidebar = $('command-console');
  const right = sidebar.hidden ? renderer.width : Math.min(renderer.width, sidebar.getBoundingClientRect().left - canvas.getBoundingClientRect().left);
  const x = pointerPosition.x + 18 + width > right - 8 ? pointerPosition.x - 14 - width : pointerPosition.x + 18;
  const y = pointerPosition.y + 22 + height > renderer.height - 8 ? pointerPosition.y - 12 - height : pointerPosition.y + 22;
  readout.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(Math.max(readoutTop, y))}px)`;
}

function showMenu(finished = false, guide = false) {
  stopFrames();
  cancelFormationGesture();
  paused = true; keys.clear(); pointer = null; view.drag = null;
  audio.setPaused(true);
  $('menu-title').textContent = finished ? game.status === 'victory' ? 'The frontier is yours.' : 'The line has fallen.' : 'Hold the line.';
  $('menu-description').textContent = finished ? game.status === 'victory' ? `${RACES[teamRace(game, 1)].name} command is down. Your forces hold the sector.` : 'Your last nexus and construction vehicle were lost. Regroup and take another sector.' : 'The battlefield is paused.';
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
      // A doctrine Random would also draw for this seed shows as Random, so loading a save never names a
      // commander the player has not met.
      const doctrine = restored.game.ai?.doctrine;
      $('rival-doctrine').value = Object.hasOwn(DOCTRINES, doctrine ?? '') && doctrine !== randomDoctrine(restored.game.seed, 1) ? doctrine : 'random';
      $('skirmish-mode').value = SKIRMISH_MODES.find(mode => skirmishMission(mode.id) === restored.game.mission?.id)?.id ?? 'annihilation';
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
    const doctrine = $('rival-doctrine').value, mission = skirmishMission($('skirmish-mode').value);
    const prepared = restored?.game || await generateOperation(seed, $('difficulty').value, {
      ...MAP_SIZES[$('map-size').value], profile: $('map-profile').value, races: [$('player-race').value, $('enemy-race').value],
      ...(doctrine === 'random' || Object.hasOwn(DOCTRINES, doctrine) ? { aiProfiles: { 1: { doctrine } } } : {}), ...(mission ? { mission } : {}),
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
    renderer.releaseTerrain();
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
  renderer.releaseTerrain();
  $('queue-list').replaceChildren();
  keys.clear(); view.selected.clear();
  audio.setPaused(true);
  document.body.dataset.screen = 'briefing';
  $('loading').close(); $('menu').close();
  refreshSaveControls();
  if (!$('briefing').matches(':modal')) { $('briefing').close(); $('briefing').showModal(); }
  $('deploy').focus({ preventScroll: true });
}

// Army means every armed unit: haulers, engineers and construction vehicles stay where they are.
function selectArmy() {
  if (busy()) return;
  view.selected = new Set(game.entities.filter(e => e.team === 0 && e.kind === 'unit' && e.hp > 0 && UNITS[e.type].damage > 0).map(e => e.id));
  updateHUD(); acknowledge('select');
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
  cancelOrder(); if (stop) playSound('confirm'); else acknowledge('explore', 'order', units); updateHUD();
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

function cancelFormationGesture() {
  const previewing = Boolean(view.formationPreview);
  if (pointer?.formation) {
    clearTimeout(pointer.formation.timer);
    if (canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
    pointer = null;
  }
  view.formationPreview = null;
  if (previewing) setOrderHint();
}

function updateFormationPreview(active, point, held = false) {
  const formation = active.formation;
  if (!formation || (!active.dragged && !held && !view.formationPreview)) return;
  const world = renderer.screenToWorld(point.x, point.y, view), anchor = active.startWorld;
  const heading = Math.hypot(world.x - anchor.x, world.y - anchor.y) > 6 / view.zoom ? Math.atan2(world.y - anchor.y, world.x - anchor.x) : formation.heading;
  const angle = Math.atan2(Math.sin(heading - formation.heading), Math.cos(heading - formation.heading));
  const c = Math.cos(angle), s = Math.sin(angle);
  const living = new Set(game.entities.filter(unit => unit.kind === 'unit' && unit.hp > 0).map(unit => unit.id));
  const positions = formation.offsets.filter(unit => living.has(unit.id)).map(unit => ({ ...unit, x: anchor.x + unit.x * c - unit.y * s, y: anchor.y + unit.x * s + unit.y * c, angle: heading }));
  view.formationPreview = positions.length ? { x: anchor.x, y: anchor.y, heading, angle, positions } : null;
  setOrderHint();
}

function commitFormation(active) {
  const preview = view.formationPreview;
  clearTimeout(active.formation.timer);
  view.formationPreview = null;
  if (!preview) return false;
  const ids = new Set(preview.positions.map(unit => unit.id)), offsets = active.formation.offsets.filter(unit => ids.has(unit.id));
  issueOrder(game, [...ids], { type: 'move', x: preview.x, y: preview.y, formationAngle: preview.angle, facing: preview.heading, formationOffsets: offsets.map(({id, x, y}) => ({id, x, y})) });
  view.commandMarker = { x: preview.x, y: preview.y, time: performance.now() / 1000, type: 'move' };
  orderMode = null; setOrderHint(); acknowledge('move', 'order'); updateHUD();
  return true;
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
  if (event.button === 2 && event.pointerType !== 'touch' && !view.placement && !orderMode) {
    const units = selectedUnits();
    if (units.length) {
      const x = units.reduce((sum, unit) => sum + unit.x, 0) / units.length, y = units.reduce((sum, unit) => sum + unit.y, 0) / units.length;
      const sx = units.reduce((sum, unit) => sum + Math.cos(unit.angle), 0), sy = units.reduce((sum, unit) => sum + Math.sin(unit.angle), 0);
      const heading = Math.hypot(sx, sy) > .001 ? Math.atan2(sy, sx) : units[0].angle;
      pointer.formation = { heading, offsets: units.map(unit => ({ id: unit.id, type: unit.type, team: unit.team, size: unit.size, x: unit.x - x, y: unit.y - y })) };
      const active = pointer;
      active.formation.timer = setTimeout(() => { if (pointer === active && !busy()) updateFormationPreview(active, active.last, true); }, 200);
    }
  }
  if (view.placement === 'wall' && event.button === 0) {
    pointer.wall = true; pointer.pan = false; view.wallStart = { x: Math.floor(world.x), y: Math.floor(world.y) };
  }
  pointerPosition = point;
});
canvas.addEventListener('pointermove', event => {
  const point = localPoint(event); pointerPosition = point;
  view.hover = renderer.screenToWorld(point.x, point.y, view); placeReadout();
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
  if (pointer.formation) updateFormationPreview(pointer, point);
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
  if (active.formation) clearTimeout(active.formation.timer);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (busy()) { view.formationPreview = null; setOrderHint(); return; }
  const point = localPoint(event), world = renderer.screenToWorld(point.x, point.y, view);
  if (active.formation && view.formationPreview) {
    updateFormationPreview(active, point, true);
    if (commitFormation(active)) return;
  }
  if (active.wall && view.wallStart && view.placement === 'wall') {
    const result = buildWallLine(game, 0, view.wallStart.x, view.wallStart.y, Math.floor(world.x), Math.floor(world.y));
    view.wallStart = null; view.wallPlan = null; view.drag = null;
    notify(result.count ? `${result.count} wall segments ordered · ${result.cost} credits${result.reason ? ` · ${result.reason}` : ''}` : result.reason || 'Wall line could not be placed.', result.count ? 'info' : 'warning');
    if (result.count) playSound('build'); updateHUD(); setOrderHint(); return;
  }
  if (active.dragged) {
    if (view.drag && !active.pan) {
      if (!active.shift) view.selected.clear();
      const a = renderer.screenToWorld(view.drag.x1, view.drag.y1, view), b = renderer.screenToWorld(view.drag.x2, view.drag.y2, view);
      for (const e of game.entities) { const p = renderer.poseOf(e); if (e.team === 0 && e.kind === 'unit' && e.hp > 0 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) view.selected.add(e.id); }
      acknowledge('select'); updateHUD();
    }
    view.drag = null; return;
  }
  if (active.button === 2) { if (view.placement || orderMode) cancelOrder(); else commandAt(world); }
  else if (active.button === 0) {
    if (view.placement) placeAt(world, active.shift);
    else if (orderMode) commandAt(world, orderMode);
    else selectAt(world, active.shift, active.touch);
  }
});
canvas.addEventListener('pointercancel', event => { cancelFormationGesture(); touches.delete(event.pointerId); pinchDistance = 0; pointer = null; view.drag = null; view.wallStart = null; view.wallPlan = null; setOrderHint(); });
canvas.addEventListener('pointerleave', () => { if (!pointer) { pointerPosition = null; view.hover = null; $('terrain-readout').hidden = true; } });
canvas.addEventListener('dblclick', event => {
  if (busy()) return;
  const point = localPoint(event), entity = entityAt(renderer.screenToWorld(point.x, point.y, view));
  if (entity?.team === 0 && entity.kind === 'unit') {
    const topLeft = renderer.screenToWorld(0, 0, view), bottomRight = renderer.screenToWorld(renderer.width, renderer.height, view);
    view.selected = new Set(game.entities.filter(e => e.team === 0 && e.kind === 'unit' && e.type === entity.type && e.hp > 0
      && e.x >= topLeft.x && e.x <= bottomRight.x && e.y >= topLeft.y && e.y <= bottomRight.y).map(e => e.id));
    // The double click's own clicks already brought the cue and the reply.
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
function minimapPoint(event) {
  const rect = minimap.getBoundingClientRect();
  const scale = Math.min(rect.width / game.width, rect.height / game.height);
  const ox = (rect.width - game.width * scale) / 2, oy = (rect.height - game.height * scale) / 2;
  return { x: (event.clientX - rect.left - ox) / scale, y: (event.clientY - rect.top - oy) / scale };
}
function navigateMinimap(event) { Object.assign(view, minimapPoint(event)); clampCamera(); }
let mapDragging = false;
minimap.addEventListener('contextmenu', event => event.preventDefault());
minimap.addEventListener('pointerdown', event => {
  if (busy()) return;
  event.preventDefault();
  // Orders reach the tactical map too: right click commands the selection there, and an armed
  // attack-move, rally or ability target takes the next click instead of moving the camera.
  const point = minimapPoint(event), inside = point.x >= 0 && point.y >= 0 && point.x <= game.width && point.y <= game.height;
  // As on the battlefield, a right click first cancels a pending order or placement.
  if (event.button === 2) { if (orderMode || view.placement) cancelOrder(); else if (inside && !view.formationPreview) commandAt(point); return; }
  if (event.button === 0 && orderMode && inside) { commandAt(point, orderMode); return; }
  mapDragging = true; minimap.setPointerCapture(event.pointerId); navigateMinimap(event);
});
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
  else if (key === 'f') triggerAbility();
  else if (key === 'backspace') { event.preventDefault(); jumpToAlert(); }
  else if (event.code === 'Period') cycleIdle('units', event.shiftKey);
  else if (event.code === 'Comma') cycleIdle('production');
  else if (key === ' ') centerBase();
  else if (/^Digit[1-5]$/.test(event.code)) {
    const digit = event.code.slice(-1);
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      const assigned = assignControlGroup(game, view.selected, Number(digit));
      notify(assigned.length ? `Control group ${digit}: ${assigned.length} assigned. Previous group membership removed.` : `Control group ${digit} cleared.`);
      lastGroupPress = { group: null, at: 0 };
      updateHUD(); playSound('group');
    } else {
      // A second press of the same group in quick succession brings the camera to it; only the first answers.
      const now = performance.now(), again = lastGroupPress.group === digit && now - lastGroupPress.at < 450;
      view.selected = new Set(controlGroupMembers(game, Number(digit)));
      lastGroupPress = { group: digit, at: again ? 0 : now };
      if (again) centerOnSelection(); else if (view.selected.size) acknowledge('select');
      updateHUD();
    }
  }
  else if (CARD_KEYS.includes(key) && !event.ctrlKey && !event.metaKey && !event.altKey && !$('command-console').hidden) { event.preventDefault(); pressCard(CARD_KEYS.indexOf(key), event.shiftKey); }
  else if (key === '+' || key === '=') zoom(1.15);
  else if (key === '-') zoom(1 / 1.15);
});
document.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { cancelFormationGesture(); keys.clear(); touches.clear(); pointer = null; pointerPosition = null; edgePointer = null; view.drag = null; setOrderHint(); if (launched && !paused && game.status === 'playing') showMenu(); });
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
$('deploy-nexus').addEventListener('click', () => {
  const units = selectedUnits();
  if (busy() || units.length !== 1 || unitRole(units[0]) !== 'constructor') return;
  cancelOrder();
  view.deployUnitId = units[0].id; view.placement = raceBuilding(game, 0, 'core'); view.showGrid = true;
  stopUnits(game, [units[0].id]);
  setOrderHint();
  if (compactScreen.matches) setConsole(false);
  canvas.focus({ preventScroll: true });
});
$('attack-order').addEventListener('click', () => setOrder('attackMove'));
$('move-order').addEventListener('click', () => setOrder('move'));
$('rally-order').addEventListener('click', () => setOrder('rally'));
for (const stance of ['guard', 'defend']) $(`stance-${stance}`).addEventListener('click', () => {
  if (busy()) return;
  const units = selectedUnits().filter(unit => UNITS[unit.type].damage > 0);
  if (!units.length) return;
  setUnitStance(game, units.map(unit => unit.id), stance);
  playSound('confirm'); updateHUD();
});
$('repair-building').addEventListener('click', () => {
  if (busy()) return;
  const selection = selectedEntities(); if (selection.length !== 1) return;
  const result = toggleRepair(game, selection[0].id);
  if (!result.ok) notify(result.reason, 'warning'); else playSound('repair');
  updateHUD();
});
$('sell-building').addEventListener('click', () => {
  if (busy()) return;
  const selection = selectedEntities(); if (selection.length !== 1) return;
  const result = sellBuilding(game, selection[0].id);
  if (!result.ok) notify(result.reason, 'warning');
  else { cancelOrder(); playSound('sell'); notify(`Structure sold · +${fmt(result.refund)} credits`); }
  updateHUD(); updateCatalog();
});
$('stop-order').addEventListener('click', stopSelection);
$('deselect').addEventListener('click', () => { cancelOrder(); view.selected.clear(); updateHUD(); });
$('explore-order').addEventListener('click', toggleExplore);
$('select-army').addEventListener('click', selectArmy);
$('idle-units').addEventListener('click', event => cycleIdle('units', event.shiftKey));
$('idle-production').addEventListener('click', () => cycleIdle('production'));
$('ability-order').addEventListener('click', triggerAbility);
$('home').addEventListener('click', centerBase);
$('zoom-in').addEventListener('click', () => zoom(1.18));
$('zoom-out').addEventListener('click', () => zoom(1 / 1.18));
$('pause').addEventListener('click', () => { if (launched) paused ? resume() : showMenu(); });
function setGameSpeed(percent) {
  gameSpeed = percent / 100;
  $('game-speed').value = String(percent); $('game-speed-value').value = `${percent}%`;
  $('game-speed').setAttribute('aria-valuetext', `${percent}% game speed`);
}
$('game-speed').addEventListener('input', event => setGameSpeed(event.target.valueAsNumber));
$('game-speed').addEventListener('change', event => {
  settings.speed = event.target.valueAsNumber; writeSettings(settings);
  // After a drag the arrow keys belong to the camera again; keyboard users keep the slider focused.
  if (sliderPointer) { sliderPointer = false; canvas.focus({ preventScroll: true }); }
});
$('game-speed').addEventListener('pointerdown', () => { sliderPointer = true; });
$('game-speed').addEventListener('focus', () => keys.clear());
// Interface preferences persist in this browser (hud-data settings); the renderer reads screen shake from
// view.screenShake. Sound mutes and levels are the audio engine's own settings, stored apart from these.
const SETTING_LABELS = { edgeScroll: ['edge-scroll-toggle', 'Edge scroll'], shake: ['shake-toggle', 'Screen shake'], tooltips: ['tooltips-toggle', 'Tooltips'] };
function updateSettingButtons() {
  for (const [key, [id, label]] of Object.entries(SETTING_LABELS)) { $(id).setAttribute('aria-pressed', String(settings[key])); $(id).textContent = `${label} ${settings[key] ? 'on' : 'off'}`; }
}
for (const [key, [id]] of Object.entries(SETTING_LABELS)) $(id).addEventListener('click', () => {
  settings[key] = !settings[key]; writeSettings(settings);
  view.screenShake = settings.shake; if (!settings.tooltips) hideCardTooltip();
  updateSettingButtons(); if (game) updateHUD();
});
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
// Terrain choices follow the simulation's profile table; its first profile stays the default.
$('map-profile').replaceChildren(...Object.entries(MAP_PROFILES).map(([id, profile]) => new Option(profile.name, id)));
// Rival commanders and skirmish modes come from the AI and campaign tables. The simulation resolves Random
// from the operation seed; a mode other than Annihilation runs as the operation it names.
$('rival-doctrine').replaceChildren(...doctrineOptions().map(option => new Option(option.name, option.id)));
$('skirmish-mode').replaceChildren(...SKIRMISH_MODES.map(mode => new Option(mode.name, mode.id)));
const skirmishMission = id => { const mode = SKIRMISH_MODES.find(m => m.id === id), mission = mode?.mission ?? mode?.id; return mode && mode.id !== 'annihilation' && Object.hasOwn(MISSIONS, mission) ? mission : undefined; };
function updateMapDescription() {
  const size = MAP_SIZES[$('map-size').value];
  $('race-description').textContent = RACES[$('player-race').value].description;
  $('map-description').textContent = `${MAP_PROFILES[$('map-profile').value].description} ${fmt(size.width * size.height)} tiles to explore.`;
  // Commanders carry their rival race's names, so the labels follow the rival faction.
  const doctrines = doctrineOptions($('enemy-race').value), doctrine = doctrines.find(option => option.id === $('rival-doctrine').value);
  doctrines.forEach((option, index) => { if (option.id !== 'random') $('rival-doctrine').options[index].text = `${option.name} · ${option.commander}`; });
  $('doctrine-description').textContent = doctrine && doctrine.id !== 'random' ? `${doctrine.commander}: ${doctrine.description}` : 'The sector seed decides which commander leads the rival claim.';
  $('mode-description').textContent = SKIRMISH_MODES.find(mode => mode.id === $('skirmish-mode').value)?.description ?? '';
}
for (const id of ['map-profile', 'map-size', 'player-race', 'enemy-race', 'rival-doctrine', 'skirmish-mode']) $(id).addEventListener('change', updateMapDescription);
$('launch-form').addEventListener('submit', event => { event.preventDefault(); prepareOperation(); });

function requestFrame() {
  if (!frameRequest && launched && !paused && !loading) frameRequest = requestAnimationFrame(frame);
}
function stopFrames() { if (frameRequest) cancelAnimationFrame(frameRequest); frameRequest = 0; }

function simulateFrameStep(dt) {
  renderer.snapshot(game); // Frames until the next tick blend from these poses.
  updateGame(game, dt); soundscape.tick(game);
  if (game.status === 'playing') return true;
  showMenu(true); playSound(game.status); return false;
}

function frame(now) {
  frameRequest = 0;
  if (!launched || loading || !game) return;
  if (paused) { updateHUD(); return; }
  const elapsed = Math.min((now - lastTime) / 1000, .2); lastTime = now;
  if (!busy()) {
    // Speed controls fixed simulation time; input/rendering still get a turn
    // between expensive ticks when large battles exceed the frame's CPU budget.
    accumulator = advanceSimulationFrame(accumulator, elapsed, gameSpeed, simulateFrameStep);
    const panSpeed = 400 / view.zoom * elapsed;
    const direction = cameraDirection(keys, settings.edgeScroll && !pointer?.pan && !touches.size ? edgePointer : null, renderer.width, renderer.height);
    view.x += direction.x * panSpeed; view.y += direction.y * panSpeed;
    clampCamera();
    if (game.events.length < lastEvent) lastEvent = 0;
    reportEvents(lastEvent);
    lastEvent = game.events.length;
    for (const reply of soundscape.takeReplies()) bark(getEntity(game, reply.entityId), reply.context);
  }
  if (pointerPosition && !busy()) view.hover = renderer.screenToWorld(pointerPosition.x, pointerPosition.y, view);
  if (pointer?.formation && view.formationPreview && !busy()) updateFormationPreview(pointer, pointer.last, true);
  if (view.placement === 'wall' && view.hover && !busy()) {
    const to = { x: Math.floor(view.hover.x), y: Math.floor(view.hover.y) }, from = view.wallStart || to;
    const key = `${from.x}:${from.y}:${to.x}:${to.y}:${game.navVersion}`;
    if (key !== wallPreviewKey || now - wallPreviewAt > 150 || !view.wallPlan) {
      view.wallPlan = planWallLine(game, 0, from.x, from.y, to.x, to.y); wallPreviewKey = key; wallPreviewAt = now; setOrderHint();
    }
  } else view.wallPlan = null;
  if (view.deployUnitId && !getEntity(game, view.deployUnitId)) cancelOrder();
  const check = view.placement && view.hover ? view.deployUnitId ? deploymentStatus(game, 0, view.deployUnitId, Math.floor(view.hover.x), Math.floor(view.hover.y)) : canPlace(game, 0, view.placement, Math.floor(view.hover.x), Math.floor(view.hover.y)) : null;
  view.placementValid = Boolean(check?.ok);
  if ((check?.reason || '') !== view.placementReason) { view.placementReason = check?.reason || ''; setOrderHint(); }
  if (view.commandMarker && now / 1000 - view.commandMarker.time > .85) view.commandMarker = null;
  renderer.pendingTime = accumulator; // How far the drawn frame has progressed toward the next tick.
  renderer.draw(game, view);
  // After the draw, so blasts the renderer holds for an arriving shell are heard when they are shown.
  if (!busy()) soundscape.frame(game, view, { width: renderer.width, height: renderer.height, levels: cameraLevels() }, renderer);
  drawAbilityPreview(); drawAlertPings(now);
  if (!busy()) checkIntercept(now);
  if (now - hudTimer > 150) {
    updateHUD(); hudTimer = now;
  }
  expireToasts(now);
  if (barkUntil && now > barkUntil) { $('comms').classList.add('leaving'); if (now > barkUntil + 400) { $('comms').hidden = true; barkUntil = 0; } }
  requestFrame();
}

$('seed').value = randomSeed();
setGameSpeed(settings.speed); updateSettingButtons();
updateMapDescription(); updateSoundButton(); bindAudioControls(audio);
$('deploy').disabled = false;
showBriefing();

// Menu readiness is separate from battlefield readiness: no world exists before deployment.
window.ashline = { booted: true, get state() { return game; }, view, renderer, assets: assetStatus,
  get loading() { return loading; }, get paused() { return paused; }, get audio() { return audio.status; } };
