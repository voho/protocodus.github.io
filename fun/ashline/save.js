import {BUILDINGS, UNITS, UNIT_CAP, RESEARCH, BUILDING_UPGRADES, RACES, buildingRole, unitRole, teamRace, raceBuilding, raceUnit, unitStats} from './sim.js';

export const SAVE_KEY = 'ashline.save.v1';
const VERSION = 1, MAX_BYTES = 4_000_000;
const FIELDS = ['width', 'height', 'seed', 'mapProfile', 'difficulty', 'rng', 'nextId', 'time', 'status', 'entities', 'teams', 'effects', 'events', 'navVersion', 'navBuilt', 'fogClock', 'ai', 'aiTeams', 'aiByTeam', 'alertAt'];
const GRIDS = {terrain: Uint8Array, minerals: Float32Array, mineralTypes: Uint8Array, blocked: Uint8Array, regions: Uint16Array};
const fail = reason => { throw new Error(reason); };
const valid = condition => { if (!condition) fail('Saved operation is damaged or incompatible.'); };
const number = (value, min = -1e12, max = 1e12) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min = 0, max = 1e12) => Number.isInteger(value) && number(value, min, max);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dimensions = value => object(value) && [[72,56],[144,112],[192,144],[224,168]].some(([width,height])=>value.width===width&&value.height===height);
const inBounds = (value, width, height) => object(value) && number(value.x, 0, width) && number(value.y, 0, height);

// Bound the JSON graph before reading fields, including optional order/path data.
function validateTree(value, depth = 0) {
  valid(depth <= 12);
  if (typeof value === 'number') valid(Number.isFinite(value));
  else if (typeof value === 'string') valid(value.length <= 1000);
  else if (value && typeof value === 'object') {
    const entries = Object.entries(value); valid(entries.length <= 100_000);
    for (const [key, child] of entries) {
      valid(!['__proto__', 'constructor', 'prototype'].includes(key));
      validateTree(child, depth + 1);
    }
  }
}

function validateGame(s) {
  valid(dimensions(s));
  const {width, height} = s, cells = width * height, point = value => inBounds(value, width, height);
  valid(typeof s.seed === 'string' && ['easy', 'normal', 'hard'].includes(s.difficulty));
  if(s.mapProfile!==undefined)valid(['rift','basin','highlands'].includes(s.mapProfile));
  if(s.alertAt!==undefined)valid(number(s.alertAt,0,s.time));
  valid(['playing', 'victory', 'defeat'].includes(s.status) && number(s.time, 0));
  valid(integer(s.rng, 1, 0xffffffff) && integer(s.nextId, 1) && integer(s.navVersion) && integer(s.navBuilt, -1) && s.navBuilt <= s.navVersion && number(s.fogClock, -1, 1));
  const grid = (values, max, whole = true) => Array.isArray(values) && values.length === cells && values.every(value => whole ? integer(value, 0, max) : number(value, 0, max));
  valid(grid(s.terrain, 5) && grid(s.minerals, 1e6, false) && grid(s.mineralTypes, 3) && grid(s.blocked, 1) && grid(s.regions, cells));
  for (const key of ['visible', 'explored']) valid(Array.isArray(s[key]) && s[key].length === 2 && s[key].every(values => grid(values, 1)));
  valid(Array.isArray(s.teams) && s.teams.length === 2 && s.teams.every(t => object(t) && number(t.credits, 0) && integer(t.kills)));
  for(const team of s.teams){
    if(team.race!==undefined)valid(Object.hasOwn(RACES,team.race));
    if(team.research!==undefined)valid(object(team.research)&&Object.entries(team.research).every(([id,value])=>Object.hasOwn(RESEARCH,id)&&value===true&&RESEARCH[id].requires.every(required=>team.research[required])));
    if(team.powerStatus!==undefined)valid(['stable','reserve','brownout'].includes(team.powerStatus));
  }
  valid(Array.isArray(s.entities) && s.entities.length <= cells + UNIT_CAP*2);
  const ids = new Set(), unitCounts = [0, 0];
  for (const e of s.entities) {
    valid(object(e) && ['unit', 'building'].includes(e.kind) && [0, 1].includes(e.team));
    const definitions = e.kind === 'building' ? BUILDINGS : UNITS;
    valid(Object.hasOwn(definitions, e.type)); const d = definitions[e.type], role=e.kind==='building'?buildingRole(e):unitRole(e);
    valid(d.race==='both'||d.race===teamRace(s,e.team));
    valid(integer(e.id, 1, s.nextId - 1) && !ids.has(e.id)); ids.add(e.id);
    valid(e.rank === undefined && (e.kills === undefined || e.kind === 'unit' && integer(e.kills)));
    if(e.tech!==undefined)valid(e.kind==='unit'&&Array.isArray(e.tech)&&e.tech.length<=Object.keys(RESEARCH).length&&new Set(e.tech).size===e.tech.length&&e.tech.every(id=>Object.hasOwn(RESEARCH,id)&&RESEARCH[id].requires.every(required=>e.tech.includes(required))));
    const maxHp = e.kind === 'unit' ? unitStats(e).hp : d.hp;
    valid(e.size === d.size && e.maxHp === maxHp && number(e.hp, 0, maxHp) && number(e.progress, 0, 1) && point(e) && number(e.angle) && number(e.cooldown, 0) && number(e.repath));
    valid(object(e.order) && ['idle', 'move', 'attack', 'attackMove', 'harvest', 'explore'].includes(e.order.type));
    if(e.order.speedLimit!==undefined)valid(e.kind==='unit'&&e.order.type==='attackMove'&&number(e.order.speedLimit,.1,30));
    if (['move', 'attack', 'attackMove'].includes(e.order.type)) valid(point(e.order));
    for (const key of ['x', 'y']) if (e.order[key] !== undefined) valid(number(e.order[key], 0, key === 'x' ? width : height));
    for (const key of ['targetId', 'attackerId']) if (e[key] != null) valid(integer(e[key], 1, s.nextId - 1));
    if (e.order.targetId != null) valid(integer(e.order.targetId, 1, s.nextId - 1));
    if (e.order.tile !== undefined) valid(integer(e.order.tile, 0, cells - 1) && point(e.order) && number(e.order.nextPlan, 0) && integer(e.order.navVersion));
    valid(Array.isArray(e.path) && e.path.length <= cells && e.path.every(point));
    if (e.pathGoal !== undefined) valid(point(e.pathGoal));
    if (e.rally !== undefined) valid(point(e.rally));
    if (e.trafficWait !== undefined) valid(e.kind === 'unit' && number(e.trafficWait, 0, .8));
    if(e.turnVelocity!==undefined)valid(e.kind==='unit'&&number(e.turnVelocity));
    if(e.moveSpeed!==undefined)valid(e.kind==='unit'&&number(e.moveSpeed,0,30));
    if(e.moving!==undefined)valid(e.kind==='unit'&&typeof e.moving==='boolean');
    if(e.steerSide!==undefined)valid(e.kind==='unit'&&[-1,1].includes(e.steerSide));
    if(e.steerUntil!==undefined)valid(e.kind==='unit'&&number(e.steerUntil,0));
    if(e.aimAngle!==undefined)valid(number(e.aimAngle));
    if (e.passUntil !== undefined) valid(e.kind === 'unit' && number(e.passUntil, 0, s.time + 1.5));
    if (e.repairing !== undefined) valid(e.kind === 'building' && typeof e.repairing === 'boolean');
    if(e.reserve!==undefined)valid(e.kind==='building'&&role==='capacitor'&&number(e.reserve,0,d.reserveCapacity));
    if(e.research!==undefined)valid(e.kind==='building'&&(e.research===null||role==='lab'&&object(e.research)&&Object.hasOwn(RESEARCH,e.research.id)&&number(e.research.progress,0,1)));
    if(e.upgrades!==undefined)valid(e.kind==='building'&&object(e.upgrades)&&Object.entries(e.upgrades).every(([id,value])=>Object.hasOwn(BUILDING_UPGRADES,id)&&value===true&&BUILDING_UPGRADES[id].types.includes(role)));
    if(e.upgrade!==undefined)valid(e.kind==='building'&&(e.upgrade===null||object(e.upgrade)&&Object.hasOwn(BUILDING_UPGRADES,e.upgrade.id)&&BUILDING_UPGRADES[e.upgrade.id].types.includes(role)&&!e.upgrades?.[e.upgrade.id]&&number(e.upgrade.progress,0,1)));
    if(e.powerRatio!==undefined)valid(e.kind==='building'&&number(e.powerRatio,0,1));
    if(e.powerStatus!==undefined)valid(e.kind==='building'&&['stable','reserve','brownout'].includes(e.powerStatus));
    if(e.wallConnections!==undefined)valid(e.kind==='building'&&role==='wall'&&integer(e.wallConnections,0,15));
    if(e.repairActive!==undefined)valid(e.kind==='unit'&&role==='engineer'&&typeof e.repairActive==='boolean');
    if(e.repairTargetId!==undefined)valid(e.kind==='unit'&&role==='engineer'&&(e.repairTargetId===null||integer(e.repairTargetId,1,s.nextId-1)));
    if (e.processingAmount !== undefined || e.processingTotal !== undefined) valid(e.kind === 'building' && ['refinery', 'core'].includes(role) && number(e.processingAmount, 0) && number(e.processingTotal, e.processingAmount));
    if(e.processingType!==undefined)valid(e.kind==='building'&&['refinery','core'].includes(role)&&integer(e.processingType,0,3));
    if(e.cargoType!==undefined)valid(e.kind==='unit'&&role==='harvester'&&integer(e.cargoType,0,3));
    if (e.unload !== undefined) valid(e.kind === 'unit' && role==='harvester' && number(e.unload, 0, 1.2));
    if (e.unloadDepotId !== undefined) {
      valid(e.kind === 'unit' && role==='harvester' && (e.unloadDepotId === null || integer(e.unloadDepotId, 1, s.nextId - 1)));
      if (e.unloadDepotId !== null) {
        const depot = s.entities.find(depot => depot.id === e.unloadDepotId);
        // Destruction later in a tick can leave this reference stale until the hauler updates.
        valid(!depot || depot.kind === 'building' && ['refinery', 'core'].includes(buildingRole(depot)) && depot.team === e.team && depot.progress === 1);
      }
    }
    if (e.kind === 'building') {
      valid(integer(e.x, 0, width - e.size) && integer(e.y, 0, height - e.size));
      valid(Array.isArray(e.queue) && e.queue.length <= 6 && e.queue.every(q => object(q) && UNITS[q.type]?.producer === e.type && number(q.progress, 0, 1)));
      if (e.haulerPending !== undefined) valid(typeof e.haulerPending === 'boolean' && role==='refinery');
    } else {
      valid(e.queue === undefined && e.haulerPending === undefined);
      valid(++unitCounts[e.team] <= UNIT_CAP && e.x < width && e.y < height && e.progress === 1);
      if (role==='harvester') valid(number(e.cargo, 0, d.capacity + .001) && ['gather', 'return'].includes(e.harvestPhase));
      if (e.mineralTile !== undefined) valid(integer(e.mineralTile, -1, cells - 1));
      if(e.mineralRetryDelay!==undefined)valid(role==='harvester'&&[4,8,12].includes(e.mineralRetryDelay));
    }
    for (const key of ['pathVersion', 'mineralNavVersion']) if (e[key] !== undefined) valid(integer(e[key]));
    for (const key of ['lastHit', 'mineralSearchAt']) if (e[key] !== undefined) valid(number(e[key], 0));
    for (const key of ['harvestTargetX', 'harvestTargetY']) if (e[key] !== undefined) valid(number(e[key], 0, key.endsWith('X') ? width : height));
  }
  if(s.aiTeams!==undefined)valid(Array.isArray(s.aiTeams)&&s.aiTeams.every(team=>[0,1].includes(team))&&new Set(s.aiTeams).size===s.aiTeams.length);
  if(s.aiByTeam!==undefined)valid(object(s.aiByTeam)&&Object.keys(s.aiByTeam).every(key=>key==='0'));
  if(s.aiTeams?.includes(0))valid(object(s.aiByTeam)&&object(s.aiByTeam[0]));
  for(const ai of [s.ai,...Object.values(s.aiByTeam||{})]){
    valid(object(ai)&&object(ai.known)&&number(ai.nextThink,0)&&number(ai.nextRaid,0)&&typeof ai.mode==='string');
    for(const key of ['scoutIndex','buildIndex','raid'])valid(integer(ai[key]));
    for(const key of ['nextExpand','regroupUntil'])if(ai[key]!==undefined)valid(number(ai[key],0));
    for(const [key,memory] of Object.entries(ai.known))valid(object(memory)&&String(memory.id)===key&&integer(memory.id,1,s.nextId-1)&&['unit','building'].includes(memory.kind)&&Object.hasOwn(memory.kind==='building'?BUILDINGS:UNITS,memory.type)&&point(memory)&&number(memory.hp,0)&&number(memory.seenAt,0));
  }
  valid(Array.isArray(s.effects) && s.effects.length <= 4096 && s.effects.every(e => object(e) && ['explosion', 'shot', 'shell', 'rocket'].includes(e.type) && point(e) && number(e.life, 0, 10) && number(e.maxLife, .001, 10) && [0, 1].includes(e.team) && (e.type === 'explosion' ? number(e.size, 0, 10) : point({x: e.tx, y: e.ty}))));
  for (const effect of s.effects) if (effect.type === 'rocket') {
    valid(['rocket', 'rocketTower'].includes(effect.weapon) && integer(effect.attackerId, 1, s.nextId - 1) && integer(effect.targetId, 1, s.nextId - 1) && number(effect.maxLife, .2, .65) && effect.life > 0 && effect.life <= effect.maxLife);
    if (effect.damage !== undefined) valid(effect.weapon === 'rocketTower' ? effect.damage === BUILDINGS[raceBuilding(s,effect.team,'rocketTower')].damage : [0, 1, 2, 3].some(rank => [1,1.18].some(weapons=>[1,1.1].some(ballistics=>effect.damage === UNITS[raceUnit(s,effect.team,'rocket')].damage * (1 + .2 * rank)*weapons*ballistics))));
  }
  valid(Array.isArray(s.events) && s.events.length <= 100_000 && s.events.every(e => object(e) && typeof e.text === 'string' && [0, 1].includes(e.team) && number(e.time, 0)));
}

export function encodeGame(game, view = {}) {
  valid(dimensions(game));
  const snapshot = Object.fromEntries(FIELDS.map(key => [key, game[key]]));
  for (const key of Object.keys(GRIDS)) snapshot[key] = Array.from(game[key]??(key==='mineralTypes'?game.minerals.map(amount=>amount>0?1:0):[]));
  for (const key of ['visible', 'explored']) snapshot[key] = game[key].map(values => Array.from(values));
  const camera = inBounds(view, game.width, game.height) && number(view.zoom, 8, 128) ? {x: view.x, y: view.y, zoom: view.zoom} : {};
  // Preserve last-seen fog knowledge, but keep DOM/canvas/input state out of the save.
  const rememberedBuildings = view.rememberedBuildings ?? [];
  const knownOre = Array.from(view.knownOre ?? new Float32Array(game.width * game.height));
  const text = JSON.stringify({version: VERSION, savedAt: new Date().toISOString(), game: snapshot, view: camera, rememberedBuildings, knownOre});
  decodeGame(text); // Validate before replacing the previous save.
  return text;
}

export function decodeGame(text) {
  valid(typeof text === 'string' && text.length <= MAX_BYTES);
  let data;
  try { data = JSON.parse(text); } catch { fail('Saved operation is damaged.'); }
  valid(object(data));
  if (data.version !== VERSION) fail('This save uses an unsupported version.');
  validateTree(data);
  valid(typeof data.savedAt === 'string' && Number.isFinite(Date.parse(data.savedAt)));
  if(object(data.game)&&data.game.mineralTypes===undefined&&Array.isArray(data.game.minerals))data.game.mineralTypes=data.game.minerals.map(amount=>amount>0?1:0);
  validateGame(data.game);
  const {width, height} = data.game, cells = width * height;
  valid(object(data.view) && (!Object.keys(data.view).length || inBounds(data.view, width, height) && number(data.view.zoom, 8, 128)));
  const rememberedBuildings = data.rememberedBuildings ?? [], knownOre = data.knownOre ?? Array(cells).fill(0);
  valid(Array.isArray(rememberedBuildings) && rememberedBuildings.length <= cells && rememberedBuildings.every(e => object(e) && e.kind === 'building' && e.team === 1 && number(e.rememberedAt, 0) && Array.isArray(e.queue) && e.queue.length <= 6));
  // The same entity schema validates remembered buildings, including ones since destroyed.
  if (rememberedBuildings.length) validateGame({...data.game, entities: rememberedBuildings});
  valid(Array.isArray(knownOre) && knownOre.length === cells && knownOre.every(value => number(value, 0, 1e6)));
  for (const [key, Type] of Object.entries(GRIDS)) data.game[key] = new Type(data.game[key]);
  for (const key of ['visible', 'explored']) data.game[key] = data.game[key].map(values => new Uint8Array(values));
  return {game: data.game, view: data.view, savedAt: data.savedAt, rememberedBuildings, knownOre: new Float32Array(knownOre)};
}

export function saveGame(game, view = {}, storage) {
  try {
    const text = encodeGame(game, view);
    (storage ?? globalThis.localStorage).setItem(SAVE_KEY, text);
    return {ok: true, reason: '', savedAt: JSON.parse(text).savedAt};
  } catch (error) {
    return {ok: false, reason: error instanceof TypeError || ['SecurityError', 'QuotaExceededError'].includes(error?.name) ? 'Could not save. Browser storage is unavailable or full.' : error?.message || 'Could not save this operation.'};
  }
}

export function loadGame(storage) {
  try {
    const text = (storage ?? globalThis.localStorage).getItem(SAVE_KEY);
    if (text === null) return {ok: false, reason: 'No saved operation.'};
    return {ok: true, reason: '', ...decodeGame(text)};
  } catch (error) {
    return {ok: false, reason: error instanceof TypeError || error?.name === 'SecurityError' ? 'Could not load. Browser storage is unavailable.' : error?.message || 'Could not load this operation.'};
  }
}

export function getSaveInfo(storage) {
  const saved = loadGame(storage);
  if (!saved.ok) return saved;
  const {seed, difficulty, time} = saved.game;
  return {ok: true, reason: '', seed, difficulty, time, savedAt: saved.savedAt};
}
