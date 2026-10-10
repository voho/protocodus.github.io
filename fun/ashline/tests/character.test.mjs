import test from 'node:test';
import assert from 'node:assert/strict';
import {UNITS, createGame, updateGame, addEntity, raceUnit, unitRole} from '../sim.js';
import {encodeGame, decodeGame} from '../save.js';
import {callsign, barkLine, barkVoice, BARK_CONTEXTS, rivalCommander, approachingColumn} from '../character.js';
import {DOCTRINES} from '../ai.js';

const quiet = (seed, races = ['organics', 'aiUnity']) => {
  const s = createGame(seed, 'normal', {width: 72, height: 56, races, aiTeams: []});
  s.terrain.fill(0); s.navVersion++; return s;
};
const roles = ['rifle', 'rocket', 'scout', 'tank', 'artillery', 'striker', 'engineer', 'harvester', 'constructor'];

test('callsigns are deterministic per seed and id, survive saving, and never touch the simulation stream', () => {
  const s = createGame('callsigns', 'normal', {width: 72, height: 56}), rng = s.rng;
  const names = s.entities.filter(e => e.kind === 'unit').map(e => callsign(s, e));
  assert(names.every(name => typeof name === 'string' && name.length > 2));
  assert.equal(s.rng, rng, 'Naming never draws from the shared random stream');
  assert.deepEqual(createGame('callsigns', 'normal', {width: 72, height: 56}).entities.filter(e => e.kind === 'unit').map(e => callsign(s, e)), names);
  const restored = decodeGame(encodeGame(s)).game;
  assert.deepEqual(restored.entities.filter(e => e.kind === 'unit').map(e => callsign(restored, e)), names, 'Names are derived, not stored, and match after loading');
  for (let i = 0; i < 40; i++) updateGame(s, .05);
  assert.deepEqual(s.entities.filter(e => e.kind === 'unit' && names.length).slice(0, names.length).map(e => callsign(s, e)), names, 'A unit keeps its name as the match runs');
  assert.notDeepEqual(createGame('other-sector', 'normal', {width: 72, height: 56}).entities.filter(e => e.kind === 'unit').map(e => callsign({seed: 'other-sector'}, e)), names);
  assert.equal(callsign(s, {id: 4, type: 'core'}), '', 'Structures have no callsign');
  assert.equal(callsign(null, s.entities[0]), '');
});

test('each race and role has its own naming style, and nearby ids never share a name', () => {
  const game = {seed: 'naming-styles'};
  for (const role of roles) {
    const organics = new Set(), unity = new Set();
    for (let id = 1; id <= 80; id++) {
      organics.add(callsign(game, {id, type: role}));
      unity.add(callsign(game, {id, type: raceUnit({teams: [{race: 'aiUnity'}]}, 0, role)}));
    }
    assert.equal(organics.size, 80, `${role}: 80 consecutive ids get 80 distinct Organics names`);
    assert.equal(unity.size, 80, `${role}: 80 consecutive ids get 80 distinct Unity designations`);
    for (const name of unity) assert.match(name, /^[A-Z][a-z]+ \d{1,2}-\d{2}$/, 'Unity numbers its machines by cohort and serial');
  }
  assert.match(callsign(game, {id: 7, type: 'rifle'}), /^[A-Z][a-z]+ [1-9]$/, 'Human squads answer to a word and a number');
  assert.match(callsign(game, {id: 7, type: 'unityRifle'}), /^Cohort \d+-\d+$/);
  const vael = callsign(game, {id: 7, type: 'rocket'});
  assert.match(vael, /^[A-Z][a-z]+ [A-Z][a-z]+$/, 'Vael launcher teams carry a given name and a clan');
  assert.match(callsign(game, {id: 7, type: 'tank'}), /^[A-Z][a-z]+ [A-Z][a-z]+$/, 'Vehicle crews nickname their machine');
});

test('barks speak for every unit and context in their race’s voice, rotating without randomness', () => {
  for (const type of Object.keys(UNITS)) {
    const voice = barkVoice(type);
    assert.equal(voice, UNITS[type].race === 'aiUnity' ? 'unity' : unitRole(type) === 'rifle' ? 'human' : unitRole(type) === 'rocket' ? 'vael' : 'crew');
    for (const context of BARK_CONTEXTS) {
      const line = barkLine(type, context, 0);
      assert(typeof line === 'string' && line.length > 3 && line.length <= 48, `${type} ${context} bark is short`);
      assert.equal(barkLine(type, context, 0), line, 'The same sequence gives the same line');
      assert(!line.includes('!'), 'Barks keep the terse military tone');
    }
  }
  const lines = new Set(Array.from({length: 6}, (_, i) => barkLine('rifle', 'move', i)));
  assert(lines.size > 1, 'Repeated orders rotate through the pool');
  assert.equal(barkLine('core', 'select'), '');
});

test('rival commanders name the doctrine leading an AI side, and only an AI side', () => {
  const s = createGame('commander', 'normal', {width: 72, height: 56});
  assert.equal(rivalCommander(s), DOCTRINES.balanced.commander);
  const chosen = Object.keys(DOCTRINES).at(-1);
  assert.equal(rivalCommander(createGame('commander', 'normal', {width: 72, height: 56, aiProfiles: {1: {doctrine: chosen}}})), DOCTRINES[chosen].commander);
  assert.equal(rivalCommander(quiet('no-commander')), null, 'A rival no AI commands has no commander to intercept');
});

test('intercepts use only current vision and point at the threatened friendly structure', () => {
  const s = quiet('intercept'), core = s.entities.find(e => e.team === 0 && e.type === 'core');
  s.entities = s.entities.filter(e => e.kind === 'building' && (e.team === 1 || e === core));
  const target = {x: core.x + core.size / 2, y: core.y + core.size / 2};
  const column = [];
  for (let i = 0; i < 6; i++) {
    const u = addEntity(s, 1, 'unit', raceUnit(s, 1, 'rifle'), target.x + 14 + (i % 3), target.y - 1 + Math.floor(i / 3));
    u.angle = Math.PI; column.push(u);
  }
  s.visible[0].fill(0);
  assert.equal(approachingColumn(s), null, 'Hidden forces never raise an intercept');
  const reveal = units => { for (const u of units) s.visible[0][Math.floor(u.y) * s.width + Math.floor(u.x)] = 1; };
  reveal(column.slice(0, 4));
  assert.equal(approachingColumn(s), null, 'Four visible contacts are not a column');
  reveal(column);
  const found = approachingColumn(s);
  assert(found, 'Five or more visible armed contacts closing on a structure form a column');
  assert.equal(found.count, 6);
  assert.deepEqual(found.target, target, 'The alert points at the friendly structure, not the hostile column');
  const outpost = addEntity(s, 0, 'building', 'reactor', Math.floor(target.x + 9), Math.floor(target.y - 1));
  assert.deepEqual(approachingColumn(s).target, {x: outpost.x + outpost.size / 2, y: outpost.y + outpost.size / 2}, 'The nearest threatened structure is named');
  for (const u of column) u.angle = 0;
  assert(approachingColumn(s), 'Contacts already within ten tiles of a structure count whatever their heading');
  s.entities = s.entities.filter(e => e !== outpost);
  for (const u of column) u.angle = 0;
  assert.equal(approachingColumn(s), null, 'A column heading away is not an intercept');
  for (const u of column) { u.x += 30; u.angle = Math.PI; }
  reveal(column);
  assert.equal(approachingColumn(s), null, 'Distant traffic beyond reach is ignored');
  for (const u of column) u.type = raceUnit(s, 1, 'harvester');
  assert.equal(approachingColumn(s), null, 'Unarmed traffic is not a column');
});
