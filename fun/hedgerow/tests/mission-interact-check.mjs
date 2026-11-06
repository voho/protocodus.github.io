// Real mission controller: equipment requires a deliberate continuous hold,
// uses simulation time, cancels partial work safely, and emits one action.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const { createMission } = await import('../js/mission.js');

function scenario(overrides = {}) {
  const events = [], sent = [], display = {}, handlers = new Map();
  const equipment = { x: 10, y: 2, z: 20, model: { anchors: {} }, object: null };
  const placed = new Map([['relay', equipment]]);
  const action = { id: 'transmit', text: 'Tune the relay and start the report', kind: 'interact', target: 'relay', action: 'transmit', x: 10, z: 20, r: 2.2, time: 1.5, prompt: 'tune the relay', progressText: 'Tuning the relay', ...overrides };
  const L = { pickups: [], hints: [], checkpoints: [{ spawn: [9, 20, 0] }], objectives: [
    action,
    { id: 'report', kind: 'hold', text: 'Defend the relay', x: 10, z: 20, r: 8, time: 45, counter: ['reserve'] },
    { id: 'rally', kind: 'reach', text: 'Reach the rally point', x: 50, z: 60, r: 3 },
  ] };
  let holding = false, pressed = false;
  const G = {
    player: { alive: true, health: 100, pos: { x: 9, y: 2, z: 20 }, inventory: () => ({}) },
    models: new Map(), enemies: [], stats: { objectives: 0 }, time: 0, rig: { yaw: 0 }, scene: { add() {}, remove() {} },
    hud: { objective(text) { display.objective = text; }, notice(title, text) { display.notice = { title, text }; }, prompt(text) { display.prompt = text; }, objectiveMarker(angle, distance) { display.marker = { angle, distance }; } },
    audio: { ui() {} }, enemyCtl: { send(...args) { sent.push(args); } },
    events: {
      on(name, callback) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(callback); },
      emit(name, payload) { events.push({ name, payload }); for (const callback of handlers.get(name) || []) callback(payload); },
    },
  };
  const M = createMission(G, L, { placed }); M.start();
  const input = { held: (key) => holding && key === 'KeyF', pressed: (key) => pressed && key === 'KeyF' };
  function tick(dt = 0.05, held = false, tap = false) { holding = held; pressed = tap; G.time += dt; M.update(dt, input); }
  function move(x, z, y = 2) { Object.assign(G.player.pos, { x, z, y }); }
  return { G, M, L, action, equipment, placed, events, sent, display, tick, move, actions: () => events.filter((e) => e.name === 'missionAction') };
}

{
  const { M, G, tick, move, actions, display, sent } = scenario();
  tick(90); assert.equal(M.index, 0); assert.equal(M.interaction, null); assert.equal(sent.length, 0, 'being near equipment never starts the defence automatically');
  assert.equal(display.prompt, 'Hold <b>F</b> to tune the relay');
  tick(0.05, false, true); assert.equal(M.interaction, null, 'an F press without a continuous hold is insufficient');
  tick(0.75, true); assert.equal(M.interaction.progress, 0.5); assert.match(display.prompt, /Tuning the relay — 50%/);
  assert.equal(actions().length, 0); assert.equal(M.isActive('report'), false);
  tick(0.05, false); assert.equal(M.interaction, null, 'releasing F cancels partial work');
  tick(0.8, true); assert.equal(M.isComplete('transmit'), false, 'separate holds cannot be accumulated');
  move(13, 20); tick(0.1, true); assert.equal(M.interaction, null, 'leaving the equipment cancels work'); assert.equal(display.prompt, null);
  move(9, 20); tick(0.75, true); move(9, 20, 5); tick(0.1, true); assert.equal(M.interaction, null, 'another floor cannot operate the equipment through its ceiling');
  move(9, 20); tick(0.75, true);
  G.events.emit('playerDied'); assert.equal(M.interaction, null, 'death cancels immediately even when the dead frame skips mission.update'); assert.equal(display.prompt, null);
  G.player.alive = false; tick(5, true); assert.equal(M.isComplete('transmit'), false);
  G.player.alive = true; tick(0.75, true); M.restoreCheckpoint(); assert.equal(M.interaction, null, 'retry cancels partial work'); assert.equal(display.prompt, null);
  tick(0.8, true); assert.equal(M.isComplete('transmit'), false, 'retry cannot inherit earlier work');
  M.start(); assert.equal(M.interaction, null, 'mission restart clears partial work');
  tick(1.0, true);
  const beforePause = M.interaction.elapsed;
  G.time += 3600; // a paused/menu interval: no simulation update is delivered
  assert.equal(M.interaction.elapsed, beforePause, 'paused wall time does not advance work');
  tick(0.2, true); assert.ok(Math.abs(M.interaction.elapsed - 1.2) < 1e-9, 'resuming uses the new simulation delta, not wall time since starting');
  tick(0.05, false); assert.equal(M.interaction, null);
  let phaseAtAction = null; G.events.on('missionAction', () => { phaseAtAction = M.isActive('report'); });
  tick(0.75, true); tick(0.75, true);
  assert.equal(M.isActive('report'), true); assert.equal(phaseAtAction, true, 'listeners observe committed objective progress');
  assert.deepEqual(display.notice, { title: 'Objective complete', text: 'Tune the relay and start the report' }, 'completion notice names the finished action rather than the next defence order');
  assert.equal(M.interaction, null); assert.equal(M.held, 0); assert.equal(sent.length, 0);
  assert.equal(actions().length, 1); assert.deepEqual(actions()[0].payload, { action: 'transmit', target: 'relay', objective: 'transmit', x: 10, y: 2, z: 20 });
  assert.equal(display.prompt, null);
  tick(0.1, true); tick(0.1, true); M.restoreCheckpoint(); tick(0.1, true);
  assert.equal(actions().length, 1, 'completion never emits twice after more input or retry');
  assert.equal(M.isComplete('transmit'), true, 'a completed action persists through checkpoint retry');
  assert.equal(G.stats.objectives, 1);
}
{
  const { M, placed, equipment, tick, actions, display } = scenario();
  placed.delete('relay'); tick(3, true);
  assert.equal(M.isComplete('transmit'), false, 'a missing target cannot be operated'); assert.equal(display.prompt, null);
  placed.set('relay', equipment); tick(1.5, true); assert.equal(actions().length, 1);
}
{
  const { M, tick, display, actions } = scenario({ x: undefined, z: undefined });
  tick(0.05); assert.equal(display.marker.distance, 1, 'a target-only action gets its marker from the placed equipment');
  tick(1.5, true); assert.equal(M.isComplete('transmit'), true); assert.equal(actions()[0].payload.x, 10);
}
// Connect the controller to the production keyboard adapter as a final
// proof: held F comes from real keydown/keyup events, not progress setters.
{
  const { createInput } = await import('../js/input.js');
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
  try {
    const canvas = new EventTarget(), input = createInput(canvas);
    const { M, G, actions } = scenario(); input.enable(true);
    const key = (type) => { const e = new Event(type); Object.assign(e, { code: 'KeyF' }); window.dispatchEvent(e); };
    const frame = () => { G.time += 0.05; M.update(0.05, input); input.endFrame(); };
    key('keydown'); for (let i = 0; i < 15; i++) frame();
    assert.ok(M.interaction.progress > 0.49 && M.interaction.progress < 0.51);
    input.enable(false); const pausedAt = M.interaction.elapsed; G.time += 120;
    assert.equal(M.interaction.elapsed, pausedAt, 'the paused game leaves partial work frozen');
    input.enable(true); frame(); assert.equal(M.interaction, null, 'input cleared during pause is treated as a release on the first playing frame');
    key('keyup'); key('keydown'); for (let i = 0; i < 30; i++) frame(); key('keyup'); frame();
    assert.equal(M.isComplete('transmit'), true, 'actual keyboard-held F completes the equipment action');
    assert.equal(actions().length, 1); assert.equal(M.interaction, null);
  } finally { globalThis.window = previousWindow; globalThis.document = previousDocument; }
}
console.log('mission-interact-check: continuous hold, contextual progress, simulation-time pause, range/floor/release/death/retry resets, missing targets and exactly-once action events pass');
