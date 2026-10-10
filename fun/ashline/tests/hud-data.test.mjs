import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILDINGS, UNITS, EVENT_KINDS, createGame, updateGame, canPlace, placeBuilding, getEntity, addEntity, armorMultiplier, raceUnit, raceBuilding, unitRole, issueOrder} from '../sim.js';
import {eventKind, eventRoute, cardStats, idleSummary, IDLE_GROUPS, readSettings, writeSettings, DEFAULT_SETTINGS, SETTINGS_KEY} from '../hud-data.js';

const memoryStorage = (entries = {}) => { const memory = new Map(Object.entries(entries)); return {memory, getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value))}; };

test('saves without typed events route by their text exactly as typed events do', () => {
  const s = createGame('hud-routing', 'hard', {width: 72, height: 56, races: ['organics', 'aiUnity'], aiTeams: [0, 1]});
  for (let tick = 0; tick < 4800 && s.status === 'playing'; tick++) updateGame(s, .05);
  const kinds = new Set();
  for (const event of s.events) {
    assert(EVENT_KINDS.includes(event.kind));
    assert.equal(eventKind(event), event.kind);
    // Old saves stored only {text, team, time}: the copy alone must recover the same kind.
    assert.equal(eventKind({text: event.text, team: event.team, time: event.time}), event.kind, `"${event.text}" keeps its kind without a stored kind`);
    kinds.add(event.kind);
  }
  for (const kind of ['opening', 'ready', 'placed', 'online', 'delivery', 'unitLost', 'underAttack']) assert(kinds.has(kind), `The duel exercises ${kind}`);
  assert.equal(eventKind({text: 'Something new'}), 'message');
});

test('event routes give victory a success tone, warnings an alert, and keep chatter out of the log', () => {
  const victory = 'All hostile nexuses and construction vehicles destroyed. Sector secured.';
  assert.equal(eventRoute({text: victory, kind: 'victory'}).tone, 'success', 'The victory line is not styled as a warning');
  assert.equal(eventRoute({text: victory}).tone, 'success', 'Old saves route the victory line by text');
  assert.equal(eventRoute({text: 'All nexuses and construction vehicles lost. Operation failed.'}).tone, 'warning');
  for (const kind of ['underAttack', 'structureLost', 'haulersLost', 'bayBlocked', 'wave']) {
    const route = eventRoute({text: '', kind});
    assert.equal(route.tone, 'warning'); assert(route.alert, `${kind} is a jump-to alert`);
  }
  assert.deepEqual([eventRoute({kind: 'unitLost', text: 'Rifle squad lost'}).tone, eventRoute({kind: 'unitLost', text: 'Rifle squad lost'}).alert], ['loss', true]);
  assert.equal(eventRoute({kind: 'delivery', text: 'Shard delivery: +200 credits'}).toast, false, 'Deliveries are a sound, not a message');
  assert.equal(eventRoute({kind: 'delivery', text: ''}).sound, 'delivery');
  for (const kind of ['placed', 'walls', 'sold', 'researchStarted', 'upgradeStarted', 'deployed']) assert.equal(eventRoute({kind, text: ''}).toast, false, `${kind} answers a click that already replied`);
  assert.equal(eventRoute({kind: 'dialogue', text: 'Hold.', speaker: 'Range control'}).tone, 'comms');
  const brownout = eventRoute({kind: 'power', status: 'brownout', text: 'Power shortage: defenses offline; production, research, and repairs slowed. Build reactors.'});
  assert.equal(brownout.toast, false, 'The HUD raises its own low-power warning');
  assert.equal(eventRoute({text: 'Capacitor reserve engaged. Restore power before it empties.'}).tone, 'caution');
  assert.equal(eventRoute({text: 'Power grid restored.'}).tone, 'success');
  for (const kind of EVENT_KINDS) assert(['info', 'success', 'caution', 'warning', 'loss', 'comms'].includes(eventRoute({kind, text: ''}).tone), `${kind} has a tone`);
});

test('card statistics derive DPS from damage per interval and counters from the armor table', () => {
  const probes = {infantry: {kind: 'unit', type: 'rifle'}, light: {kind: 'unit', type: 'scout'}, heavy: {kind: 'unit', type: 'tank'}, building: {kind: 'building', type: 'core'}};
  for (const type of [...Object.keys(UNITS), 'turret', 'rocketTower', 'unityTurret', 'unityRocketTower'].filter(type => UNITS[type] || BUILDINGS[type])) {
    const d = UNITS[type] ?? BUILDINGS[type], stats = cardStats(type);
    assert.equal(stats.name, d.name); assert.equal(stats.cost, d.cost); assert.equal(stats.hp, d.hp);
    if (!(d.damage > 0)) { assert.equal(stats.dps, 0); assert.deepEqual([stats.strong, stats.weak], [[], []]); continue; }
    assert(Math.abs(stats.dps - d.damage / d.interval) < 1e-9, `${type} DPS is damage / interval`);
    assert.equal(stats.range, d.range);
    for (const [armor, probe] of Object.entries(probes)) {
      const multiplier = armorMultiplier({type}, probe);
      assert.equal(stats.multipliers[armor], multiplier);
      if (multiplier >= 1.2) assert(stats.strong.includes(armor), `${type} is strong against ${armor}`);
      if (multiplier <= .5) assert(stats.weak.includes(armor), `${type} is weak against ${armor}`);
    }
  }
  assert.deepEqual(cardStats('rocket').strong, ['heavy']); assert.deepEqual(cardStats('rocket').weak, ['infantry']);
  assert.deepEqual(cardStats('artillery').strong, ['building']);
  assert.equal(cardStats('scout').armor, 'light'); assert.equal(cardStats('reactor').armor, 'building'); assert.equal(cardStats('reactor').speed, null);
  assert.equal(cardStats('missing'), null);
});

test('idle summary lists only the player’s waiting forces and production', () => {
  const s = createGame('hud-idle', 'normal', {width: 72, height: 56, aiTeams: []});
  s.teams[0].credits = 20000;
  const core = s.entities.find(e => e.team === 0 && e.type === 'core');
  const site = type => { for (let y = 1; y < s.height - 4; y++) for (let x = 1; x < s.width - 4; x++) if (canPlace(s, 0, type, x, y).ok) { const e = getEntity(s, placeBuilding(s, 0, type, x, y).id); e.progress = 1; e.hp = e.maxHp; return e; } throw Error(type); };
  const barracks = site('barracks'), lab = site('lab');
  let summary = idleSummary(s);
  assert.deepEqual(Object.keys(summary), IDLE_GROUPS);
  assert.deepEqual(summary.producers.map(e => e.id), [barracks.id], 'An empty barracks is idle; the refinery is not a production bay');
  assert.deepEqual(summary.labs.map(e => e.id), [lab.id], 'A laboratory with affordable research is idle');
  assert.equal(summary.combat.length, 0, 'Guards at the base are not idle reminders');
  const far = addEntity(s, 0, 'unit', raceUnit(s, 0, 'rifle'), core.x + 30, core.y - 30);
  const engineer = addEntity(s, 0, 'unit', raceUnit(s, 0, 'engineer'), core.x + 2, core.y + 4);
  const constructor = addEntity(s, 0, 'unit', raceUnit(s, 0, 'constructor'), core.x + 4, core.y + 4);
  addEntity(s, 1, 'unit', raceUnit(s, 1, 'rifle'), core.x + 31, core.y - 31);
  summary = idleSummary(s);
  assert.deepEqual(summary.combat.map(e => e.id), [far.id], 'Only the friendly unit away from base is listed; enemies never are');
  assert.deepEqual(summary.engineers.map(e => e.id), [engineer.id]);
  assert.deepEqual(summary.constructors.map(e => e.id), [constructor.id]);
  issueOrder(s, [far.id], {type: 'move', x: far.x - 2, y: far.y});
  assert.equal(idleSummary(s).combat.length, 0, 'Units under orders are not idle');
  barracks.queue.push({type: raceUnit(s, 0, 'rifle'), progress: 0});
  assert.equal(idleSummary(s).producers.length, 0);
  s.teams[0].credits = 0;
  assert.equal(idleSummary(s).labs.length, 1, 'Research that only waits for credits still counts as idle');
  s.teams[0].research = {infantryWeapons: true, infantryArmor: true, vehicleWeapons: true, mobility: true, gridEfficiency: true, advancedBallistics: true};
  assert.equal(idleSummary(s).labs.length, 0, 'A laboratory with nothing left to research is not idle');
  assert.deepEqual(idleSummary(null), Object.fromEntries(IDLE_GROUPS.map(group => [group, []])));
  assert(unitRole(far) === 'rifle' && raceBuilding(s, 0, 'lab'));
});

test('interface settings persist, and damaged or missing storage falls back to defaults', () => {
  assert.deepEqual(readSettings(memoryStorage()), DEFAULT_SETTINGS);
  const storage = memoryStorage();
  assert(writeSettings({speed: 150, edgeScroll: false, shake: false, tooltips: true, extra: 'ignored'}, storage));
  assert.deepEqual(JSON.parse(storage.memory.get(SETTINGS_KEY)), {speed: 150, edgeScroll: false, shake: false, tooltips: true});
  assert.deepEqual(readSettings(storage), {speed: 150, edgeScroll: false, shake: false, tooltips: true});
  assert.deepEqual(readSettings(memoryStorage({[SETTINGS_KEY]: '{broken'})), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(memoryStorage({[SETTINGS_KEY]: '[1,2]'})), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(memoryStorage({[SETTINGS_KEY]: '{"speed":130,"edgeScroll":"no","tooltips":false}'})), {...DEFAULT_SETTINGS, tooltips: false}, 'Unknown speeds and non-boolean flags are ignored');
  const blocked = {getItem() { throw new DOMException('denied', 'SecurityError'); }, setItem() { throw new DOMException('full', 'QuotaExceededError'); }};
  assert.deepEqual(readSettings(blocked), DEFAULT_SETTINGS);
  assert.equal(writeSettings(DEFAULT_SETTINGS, blocked), false);
});
