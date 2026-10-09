import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, updateGame, addEntity} from '../sim.js';
import {createSoundscape, placeCue, eventKind} from '../soundscape.js';
import {RECIPES} from '../soundbank.js';

// A stand-in for audio.js that records every request.
function recorder() {
  const audio = {
    calls: [], ambient: null, intensity: 0, prewarmed: [],
    play(name, options = {}) { audio.calls.push({type: 'play', name, ...options}); return true; },
    voice(name, options = {}) { audio.calls.push({type: 'voice', name, ...options}); return true; },
    setAmbient(levels) { audio.ambient = levels; },
    setIntensity(value) { audio.intensity = value; },
    prewarmVoices(keys) { audio.prewarmed = keys; },
    names() { return audio.calls.map(call => call.name); },
    take() { const calls = audio.calls; audio.calls = []; return calls; },
  };
  return audio;
}
// Open ground with fog frozen, so each test decides exactly what the player sees.
function field(seed = 'sound-field', races = ['organics', 'aiUnity']) {
  const s = createGame(seed, 'normal', {width: 72, height: 56, aiTeams: [], races});
  s.terrain.fill(0); s.navVersion++; s.fogClock = Infinity;
  s.visible.forEach(v => v.fill(0)); s.explored.forEach(v => v.fill(1));
  return s;
}
function reveal(s, x0, y0, x1, y1, value = 1) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s.visible[0][y * s.width + x] = value;
}
function rig(s, options = {}) {
  let wall = 100;
  const audio = recorder(), scape = createSoundscape(audio, {clock: () => wall});
  const view = {x: 20, y: 20, zoom: 40, ...options.view}, screen = {width: 1440, height: 900, levels: [24, 30, 36, 42, 48], ...options.screen};
  scape.reset(s);
  return {audio, scape, view, screen, advance(seconds = 1) { wall += seconds; }, frame() { scape.frame(s, view, screen); wall += 1 / 60; }};
}
const shot = (s, team, weapon, from, to, type = 'shot') => {
  const effect = {type, weapon, x: from.x, y: from.y, tx: to.x, ty: to.y, life: type === 'shell' ? .35 : .13, maxLife: type === 'shell' ? .35 : .13, team};
  s.effects.push(effect); return effect;
};

test('camera placement pans by screen position and fades beyond the view', () => {
  const view = {x: 50, y: 50, zoom: 40}, screen = {width: 1600, height: 1000};
  assert.deepEqual(placeCue(50, 50, view, screen), {pan: 0, gain: 1, distant: false});
  const right = placeCue(70, 50, view, screen), left = placeCue(30, 50, view, screen), beyond = placeCue(90, 50, view, screen);
  assert(right.pan > .7 && left.pan < -.7 && Math.abs(right.gain - .8) < 1e-9 && right.gain === left.gain && !right.distant);
  assert(beyond.gain > 0 && beyond.gain < right.gain && beyond.distant, 'Off-screen combat is quieter and muffled');
  assert.equal(placeCue(130, 50, view, screen).gain, 0, 'Distant combat is silent');
});

test('gunfire is heard at a visible muzzle, at the visible impact of a hidden shooter, and never from hidden fights', () => {
  const s = field(), {audio, scape, frame} = rig(s);
  reveal(s, 10, 10, 30, 30);
  shot(s, 0, 'rifle', {x: 15, y: 20}, {x: 25, y: 20});
  scape.tick(s); frame();
  let [call] = audio.take();
  assert.equal(call.name, 'organics.rifle', 'Organics fire uses the Organics timbre');
  assert(call.pan < 0 && call.gain > .5, 'Visible fire is placed at the muzzle, left of centre');
  shot(s, 1, 'tank', {x: 40, y: 20}, {x: 25, y: 20});
  scape.tick(s); frame();
  [call] = audio.take();
  assert.equal(call.name, 'aiUnity.tank', 'The rival Unity tank keeps its own timbre');
  assert(call.pan > 0 && call.pan < .3, 'A hidden shooter is heard at its visible impact point, not at its position');
  shot(s, 1, 'rifle', {x: 45, y: 40}, {x: 50, y: 40});
  shot(s, 1, 'rocket', {x: 45, y: 40}, {x: 25, y: 20}, 'rocket');
  scape.tick(s); frame();
  assert.deepEqual(audio.take(), [], 'A fight entirely under fog and a hidden rocket launch are silent');
  assert.equal(scape.intensity > 0, true);
});

test('artillery lands after its flight and is heard only if the landing is still visible', () => {
  const s = field(), {audio, scape, frame} = rig(s);
  reveal(s, 10, 10, 30, 30);
  shot(s, 0, 'artillery', {x: 12, y: 20}, {x: 26, y: 20}, 'shell');
  scape.tick(s); frame();
  assert.deepEqual(audio.take().map(call => call.name), ['organics.artillery'], 'The report is heard at once; the landing waits for the flight');
  for (let i = 0; i < 8; i++) { updateGame(s, .05); scape.tick(s); }
  frame();
  const landing = audio.take().find(call => call.name === 'impact.shell');
  assert(landing && landing.pan > 0, 'The shell lands at its target point');
  shot(s, 1, 'artillery', {x: 60, y: 45}, {x: 26, y: 20}, 'shell');
  scape.tick(s); frame();
  assert.deepEqual(audio.take().map(call => call.name), ['impact.whistle'], 'Incoming fire from a hidden gun only whistles at the visible target');
  reveal(s, 10, 10, 30, 30, 0);
  for (let i = 0; i < 8; i++) { updateGame(s, .05); scape.tick(s); }
  frame();
  assert.deepEqual(audio.take(), [], 'A landing hidden by the time it arrives stays silent');
});

test('deaths are sized by what was destroyed, and only where the player can see', () => {
  const s = field(), {audio, scape, frame} = rig(s);
  reveal(s, 0, 0, 40, 40);
  const die = (team, kind, role, x, y, size = 1) => {
    s.events.push({text: 'x', team, time: s.time, kind: kind === 'building' ? 'structureLost' : 'unitLost', role, x, y});
    s.effects.push({type: 'explosion', x, y, life: .6, maxLife: .6, team, size});
  };
  die(0, 'unit', 'rifle', 18, 20); die(1, 'unit', 'rifle', 22, 20); die(1, 'unit', 'tank', 20, 26);
  die(1, 'building', 'barracks', 24, 14, 3); die(1, 'building', 'wall', 14, 26.5);
  die(1, 'unit', 'tank', 60, 50);
  scape.tick(s); frame();
  const names = audio.take().map(call => call.name).sort();
  assert.deepEqual(names, ['alert.unitLost', 'death.building', 'death.infantry', 'death.robot', 'death.small', 'death.vehicle'],
    'Organics infantry thud, Unity robots break apart, vehicles pop, walls crumble, buildings collapse; the hidden tank is silent');
});

test('rocket impacts are heard where they land; barrage explosions are covered by their shells', () => {
  const s = field(), {audio, scape, frame} = rig(s);
  reveal(s, 10, 10, 30, 30);
  s.effects.push({type: 'explosion', weapon: 'rocket', x: 20, y: 20, life: .35, maxLife: .35, team: 1, size: .65});
  s.effects.push({type: 'explosion', weapon: 'rocketTower', x: 50, y: 50, life: .35, maxLife: .35, team: 1, size: 1.15});
  s.effects.push({type: 'explosion', weapon: 'artillery', x: 21, y: 21, life: .35, maxLife: .35, team: 0, size: .8});
  scape.tick(s); frame();
  assert.deepEqual(audio.take().map(call => call.name), ['impact.rocket']);
});

test('per-tick scanning hears one-tick shots in multi-tick frames and merges them by area', () => {
  const s = field('sound-skirmish'), {audio, scape, frame} = rig(s);
  reveal(s, 0, 0, 72, 56); s.visible[1].fill(1);
  for (let i = 0; i < 8; i++) { addEntity(s, 0, 'unit', 'rifle', 18 + i % 4 * .8, 18 + Math.floor(i / 4)); addEntity(s, 1, 'unit', 'unityRifle', 22 + i % 4 * .8, 18 + Math.floor(i / 4)); }
  // Eight ticks in one drawn frame, as at double speed: shots live three ticks, so most are gone by the frame.
  const seen = new WeakSet(s.effects);
  let fired = 0, firstTick = [];
  for (let tick = 0; tick < 8; tick++) {
    updateGame(s, .05);
    const fresh = s.effects.filter(e => e.type === 'shot' && !seen.has(e));
    fresh.forEach(e => seen.add(e)); fired += fresh.length; if (tick === 0) firstTick = fresh;
    scape.tick(s);
  }
  assert(firstTick.length && firstTick.every(e => !s.effects.includes(e)), 'Shots from the first tick expired before the frame');
  frame();
  const weapons = audio.take().filter(call => RECIPES[call.name]?.category === 'weapon');
  assert(fired >= 6, `The skirmish fires several shots across the frame (${fired})`);
  assert.equal(weapons.length + scape.stats.merged + scape.stats.dropped, fired, 'Every shot is heard, merged into a cue or culled by the frame budget');
  assert(weapons.length >= 2 && weapons.length <= 6 && scape.stats.merged > 0, 'Identical shots merge by kind and area within the frame budget');
  assert(weapons.some(call => call.name === 'organics.rifle') && weapons.some(call => call.name === 'aiUnity.rifle'));
});

test('typed events drive stingers, voices and transmissions; text-only events from older saves still route', () => {
  const s = field(), {audio, scape, frame, advance} = rig(s);
  const say = (kind, extra = {}, team = 0) => s.events.push({text: extra.text || kind, team, time: s.time, kind, ...extra});
  say('underAttack'); say('researchComplete'); say('upgradeComplete'); say('promotion', {rank: 1}); say('power', {status: 'brownout'});
  say('objective', {text: 'New objective: Hold the ridge'}); say('objectiveFailed'); say('wave'); say('bayBlocked');
  say('placed'); say('researchStarted'); say('opening'); say('victory');
  say('dialogue', {speaker: 'Unity relay', text: 'Claim rejected.'});
  say('underAttack', {}, 1);
  scape.tick(s); frame();
  const calls = audio.take(), names = calls.map(call => call.name);
  for (const name of ['alert.underAttack', 'alert.research', 'alert.upgrade', 'alert.promotion', 'alert.powerDown', 'alert.objectiveNew', 'alert.objectiveFailed', 'alert.wave', 'alert.warning'])
    assert(names.includes(name), `${name} plays`);
  assert.equal(names.filter(name => name === 'alert.underAttack').length, 1, 'Rival-team events are not announced');
  assert(calls.some(call => call.type === 'voice' && /^voice\.unity\.\w+\.transmission$/.test(call.name)), 'A Unity speaker transmits as a data chirp');
  assert(calls.every(call => call.pan === undefined || call.type === 'voice'), 'Alerts are centred');
  advance(3);
  say('objective', {text: 'Objective complete: Hold the ridge'}); say('power', {status: 'stable'});
  s.events.push({text: 'Rifle squad promoted to rank 2', team: 0, time: s.time}, {text: 'Signal laboratory destroyed', team: 0, time: s.time});
  scape.tick(s); frame();
  assert.deepEqual(audio.take().map(call => call.name).sort(), ['alert.objective', 'alert.powerUp', 'alert.promotion', 'alert.structureLost']);
  assert.equal(eventKind({text: 'Shard delivery: +120 credits'}), 'delivery');
  assert.equal(eventKind({text: 'Hostile nexus destroyed'}), '', 'Rival losses never sound like your own');
  assert.equal(eventKind({text: 'Tank lost', kind: 'unitLost'}), 'unitLost');
});

test('own abilities, readiness and deliveries are voiced and placed; rival abilities need vision', () => {
  const s = field(), {audio, scape, frame, advance} = rig(s);
  reveal(s, 10, 10, 30, 30);
  s.events.push({text: 'Siege crawler: Barrage', team: 0, time: 0, kind: 'ability', ability: 'barrage', role: 'artillery', entityId: 1, x: 18, y: 20});
  s.events.push({text: 'Veil skimmer: Sensor probe', team: 1, time: 0, kind: 'ability', ability: 'flare', role: 'scout', entityId: 2, x: 26, y: 20});
  s.events.push({text: 'Bastion walker: Overclock', team: 1, time: 0, kind: 'ability', ability: 'overdrive', role: 'tank', entityId: 3, x: 50, y: 50});
  scape.tick(s); frame();
  let names = audio.take().map(call => call.name);
  assert(names.includes('organics.barrage') && names.includes('voice.human.artillery.ability'));
  assert(names.includes('aiUnity.flare') && !names.includes('aiUnity.overdrive'), 'A rival ability is heard only in view');
  advance(6);
  s.events.push({text: 'Rocket team ready', team: 0, time: 1, kind: 'ready', role: 'rocket', entityId: 4, x: 20, y: 20});
  s.events.push({text: 'Shard delivery: +60 credits', team: 0, time: 1, kind: 'delivery', amount: 60, mineralType: 1, entityId: 5, x: 21, y: 21});
  scape.tick(s); frame();
  names = audio.take().map(call => call.name);
  assert(names.includes('unitReady') && names.includes('voice.vael.rocket.ready') && names.includes('delivery'), 'Vael launcher teams report in their own voice');
});

test('enemy contact sounds only for visible rival units, after a quiet gap and cooldown', () => {
  const s = field(), {audio, scape} = rig(s);
  addEntity(s, 1, 'unit', 'unityScout', 40, 30);
  const contact = () => audio.take().filter(call => call.name === 'alert.enemySpotted').length;
  const run = seconds => { for (let i = 0; i < seconds / .05; i++) { s.time += .05; scape.tick(s); } scape.frame(s, {x: 20, y: 20, zoom: 40}, {width: 1440, height: 900}); };
  run(2); assert.equal(contact(), 0, 'A hidden rival is never announced');
  reveal(s, 38, 28, 42, 32); run(1); assert.equal(contact(), 1, 'First sight of a rival unit is announced');
  run(3); assert.equal(contact(), 0, 'Continued contact stays quiet');
  reveal(s, 38, 28, 42, 32, 0); run(10); reveal(s, 38, 28, 42, 32); run(1);
  assert.equal(contact(), 0, 'Losing and regaining contact inside the cooldown stays quiet');
  reveal(s, 38, 28, 42, 32, 0); run(30); reveal(s, 38, 28, 42, 32); run(1);
  assert.equal(contact(), 1, 'Fresh contact after the cooldown is announced again');
});

test('ambient beds follow the view: visible lava only, wider views are windier, busy friendly industry hums', () => {
  const s = field(), {audio, view, frame, advance} = rig(s, {view: {x: 20, y: 20, zoom: 48}});
  for (let y = 18; y < 24; y++) for (let x = 24; x < 32; x++) s.terrain[y * s.width + x] = 3;
  frame();
  assert.equal(audio.ambient.lava.gain, 0, 'Unseen lava is silent');
  assert.equal(audio.ambient.industry.gain, 0, 'Idle bays are silent');
  const near = audio.ambient.wind.gain;
  reveal(s, 24, 18, 32, 24); view.zoom = 24; advance(.3); frame();
  assert(audio.ambient.lava.gain > .5 && audio.ambient.lava.pan > 0, 'Visible lava to the right rumbles from the right');
  assert(audio.ambient.wind.gain > near, 'Zooming out raises the wind');
  const refinery = s.entities.find(e => e.team === 0 && e.type === 'refinery');
  view.x = refinery.x; view.y = refinery.y; refinery.processingAmount = 50; advance(.3); frame();
  assert(audio.ambient.industry.gain > .2, 'A refinery processing shards hums');
});

test('combat intensity rises with heard combat, ignores hidden fights and decays', () => {
  const s = field(), {audio, scape, frame, advance} = rig(s);
  reveal(s, 10, 10, 30, 30);
  for (let i = 0; i < 20; i++) shot(s, 1, 'rifle', {x: 50, y: 50}, {x: 55, y: 50});
  scape.tick(s); frame();
  assert.equal(scape.intensity, 0, 'Hidden combat never drives the music');
  for (let i = 0; i < 20; i++) shot(s, 0, 'tank', {x: 20, y: 20}, {x: 25, y: 20});
  scape.tick(s); advance(.3); frame();
  const peak = scape.intensity;
  assert(peak > .4 && audio.intensity === peak, 'Visible combat raises the soundtrack intensity');
  s.time += 12; scape.tick(s);
  assert(scape.intensity < peak / 3, 'Intensity decays once the fighting stops');
});

test('acknowledgements speak for the lead role in its race voice; rapid reselects get annoyed', () => {
  const s = field('sound-voices', ['aiUnity', 'organics']), {audio, scape, advance} = rig(s);
  const rifle = addEntity(s, 0, 'unit', 'unityRifle', 20, 20), hauler = s.entities.find(e => e.team === 0 && e.kind === 'unit' && e.type === 'unityHarvester');
  assert(scape.acknowledge('move', [hauler, rifle]));
  assert.equal(audio.take()[0].name, 'voice.unity.rifle.move', 'Armed units lead mixed selections; Unity speaks in chirps');
  assert(scape.acknowledge('harvest', [hauler]) && audio.take()[0].name === 'voice.unity.harvester.harvest');
  assert(scape.acknowledge('harvest', [rifle]) && audio.take()[0].name === 'voice.unity.rifle.move', 'Armed units answer a harvest click as a move');
  const lines = [];
  for (let i = 0; i < 4; i++) { advance(.3); scape.acknowledge('select', [rifle]); lines.push(...audio.take().map(call => call.name.split('.').at(-1))); }
  assert.deepEqual(lines, ['select', 'select', 'select', 'annoyed']);
  advance(.05); assert.equal(scape.acknowledge('select', [rifle]), false, 'One gesture speaks once');
  assert.equal(scape.acknowledge('select', [s.entities.find(e => e.team === 0 && e.kind === 'building')]), false, 'Structures do not speak');
  assert(audio.prewarmed.includes('voice.unity.tank.attack'), 'The player race voice lines are rendered ahead of use');
});

test('the soundscape only reads the simulation and never replays a trimmed log', () => {
  const twin = seed => createGame(seed, 'hard', {width: 72, height: 56, races: ['organics', 'aiUnity'], aiTeams: [0, 1]});
  const a = twin('sound-readonly'), b = twin('sound-readonly'), {scape, frame} = rig(a);
  const plain = state => JSON.stringify(state, (key, value) => ArrayBuffer.isView(value) ? Array.from(value) : value);
  for (let tick = 0; tick < 1200; tick++) { updateGame(a, .05); scape.tick(a); if (tick % 3 === 0) frame(); updateGame(b, .05); }
  assert.equal(plain(a), plain(b), 'Listening leaves the state byte-identical');
  assert(scape.stats.cues > 0, 'The duel was audible');
  const s = field(), {audio, scape: trimmed, frame: show} = rig(s);
  for (let i = 0; i < 5; i++) s.events.push({text: 'Rifle squad under attack', team: 0, time: 0, kind: 'underAttack'});
  trimmed.tick(s); show(); audio.take();
  s.events.splice(0, 3);
  trimmed.tick(s); show();
  assert.deepEqual(audio.take(), [], 'Trimming old events replays nothing');
});
