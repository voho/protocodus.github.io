// Run with: node tests/game-analytics-check.mjs
// Run the browser entrypoints' real analytics/lifecycle functions with small
// rendering stubs, while using the games' actual definitions and score logic.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { CAMPAIGN, MISSIONS, SKIRMISH_MODES } from '../fun/ashline/campaign.js';
import { createGame } from '../fun/ashline/sim.js';
import { matchReport } from '../fun/ashline/debrief.js';
import { chapterNameAt } from '../fun/alpen/js/terrain.js';

const plain = value => JSON.parse(JSON.stringify(value));
const noop = () => {};
async function functions(path, names, globals) {
  const source = await readFile(new URL('../' + path, import.meta.url), 'utf8');
  const context = createContext(globals);
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start, `Entrypoint contains function ${name}`);
    runInContext(source.slice(start, end + 2), context, { filename: path });
  }
  return context;
}
function collector() {
  const events = [];
  return { events, window: { protocodusAnalytics: { track: (event, fields) => events.push({ event, ...plain(fields) }) } } };
}

// Ashline uses the authored mission tables, including its two mission-backed
// skirmishes. An unknown save value must never become a free-form dimension.
const ash = collector();
const ashline = await functions('fun/ashline/main.js', ['operationAnalyticsContext', 'trackOperationStart', 'simulateFrameStep'], {
  ...ash, CAMPAIGN, MISSIONS, SKIRMISH_MODES, matchReport,
  game: createGame('ANALYTICS-PRIVATE-SEED', 'hard', { width: 72, height: 56 }),
  analyticsStarted: false, analyticsStartTime: 0,
  renderer: { snapshot: noop }, soundscape: { tick: noop }, showMenu: noop, playSound: noop,
  updateGame(game, dt) { if (game.status === 'playing') { game.time += dt; game.status = 'victory'; } },
});
for (const [id, expected] of [[undefined, 'skirmish'], [CAMPAIGN[0], 'campaign'], ['drill', 'training'], ['relay-control', 'relay'], ['last-light', 'survival']]) {
  const context = plain(ashline.operationAnalyticsContext({ difficulty: 'hard', mission: id ? { id } : null }));
  assert.equal(context.game_mode, expected);
  assert.equal(context.level, id ?? SKIRMISH_MODES[0].id);
  assert.equal(context.difficulty, 'hard');
}
assert.deepEqual(plain(ashline.operationAnalyticsContext({ difficulty: 'private value', mission: { id: 'private mission' } })), {
  game_name: 'ashline', game_mode: 'skirmish', level: 'annihilation', difficulty: 'normal',
});
ashline.game.time = 100;
ashline.trackOperationStart();
ashline.trackOperationStart();
assert.equal(ash.events.length, 1, 'Resuming Ashline does not create another attempt');
ashline.simulateFrameStep(8);
ashline.simulateFrameStep(0);
assert.equal(ash.events.length, 2, 'Ashline outcome is emitted once');
assert.equal(ash.events[1].score, matchReport(ashline.game).score, 'Analytics matches the displayed score');
assert.equal(ash.events[1].duration_seconds, 8, 'Restored play measures this attempt rather than saved elapsed time');
assert.equal(ash.events[1].result, 'win');
assert.equal('seed' in ash.events[0], false);

// Alpen has no finite levels or difficulty. Its authored chapter is the useful
// context; pausing must not become a new drop-in and an explicit restart must.
const alpine = collector();
const alpen = await functions('fun/alpen/js/main.js', ['trackRunStart', 'begin', 'restartRun'], {
  ...alpine, chapterNameAt, rider: { pos: { z: -200 } }, game: { mode: 'attract' },
  input: { calm: noop }, audio: { start: noop, quiet: noop, muted: false }, showMuted: noop,
  bootReady: false, contextLost: false, runStarted: false,
  curtainPointers: new Set(), curtainClickReady: false, curtainClickDevice: null,
  controllerNotice: { hidden: false },
  curtain: { classList: { remove: noop } }, retro: { fade: noop }, pausedRendered: false, pausedWorldReady: false,
});
alpen.restart = fullReset => { alpen.rider.pos.z = fullReset ? 0 : -4000; };
alpen.begin();
assert.equal(alpine.events.length, 0, 'Loading and attract-mode previews do not count as starts');
alpen.bootReady = true;
alpen.begin();
assert.deepEqual(alpine.events[0], {
  event: 'game_start', game_name: 'alpen', game_mode: 'freeride', level: chapterNameAt(0), action: 'drop_in',
});
assert.equal(alpen.controllerNotice.hidden, true, 'Starting Alpen hides the controller disconnect notice');
alpen.game.mode = 'paused';
alpen.begin();
assert.equal(alpine.events.length, 1, 'Resuming Alpen does not create another drop-in');
alpen.restartRun();
assert.equal(alpine.events[1].action, 'restart');
assert.equal(alpine.events[1].level, chapterNameAt(-4000));
assert.equal('seed' in alpine.events[1], false);

// Tyran tracks one start/end pair per sector attempt; pausing or reopening
// saved reports must not duplicate flights or victories.
const tyr = collector();
const tyran = await functions('fun/tyran/game.js', ['trackFlightStart', 'trackFlightEnd'], {
  ...tyr, activeCampaign: true, analyticsFlight: null,
  state: { level: 2, time: 10, difficulty: 'hard', score: 1250.9 },
});
tyran.trackFlightStart();
tyran.trackFlightStart();
assert.equal(tyr.events.length, 1, 'Same sector attempt in Tyran does not emit duplicate starts');
assert.deepEqual(tyr.events[0], {
  event: 'game_start', game_name: 'tyran', game_mode: 'campaign', level: 3, difficulty: 'hard',
});
tyran.state.time = 42;
tyran.trackFlightEnd('win');
tyran.trackFlightEnd('win');
assert.equal(tyr.events.length, 2, 'Same sector attempt in Tyran does not emit duplicate outcomes');
assert.deepEqual(tyr.events[1], {
  event: 'game_end', game_name: 'tyran', game_mode: 'campaign', level: 3, difficulty: 'hard',
  result: 'win', score: 1250, duration_seconds: 32,
});

// Meteora distinguishes survival, training, special and campaign missions, and
// suppresses analytics during benchmark or debug-autopilot runs.
const met = collector();
const meteora = await functions('fun/meteora/js/main.js', ['missionAnalyticsMode', 'trackMissionStart', 'trackMissionEnd'], {
  ...met, AUTOPILOT: false, survivalRun: false, currentMission: { id: 'm01', training: false, special: false },
  world: { diff: { key: 'veteran' }, mission: { def: { id: 'm01' } } },
  results: () => ({ id: 'm01', won: true, score: 8400, time: 95 }),
});
assert.equal(meteora.missionAnalyticsMode({ training: true }), 'training');
assert.equal(meteora.missionAnalyticsMode({ special: true }), 'special');
assert.equal(meteora.missionAnalyticsMode({ training: false, special: false }), 'campaign');
assert.equal(meteora.missionAnalyticsMode(null), 'survival');
meteora.trackMissionStart();
assert.deepEqual(met.events[0], {
  event: 'game_start', game_name: 'meteora', game_mode: 'campaign', level: 'm01', difficulty: 'veteran',
});
meteora.trackMissionEnd();
assert.deepEqual(met.events[1], {
  event: 'game_end', game_name: 'meteora', game_mode: 'campaign', level: 'm01', difficulty: 'veteran',
  result: 'win', score: 8400, duration_seconds: 95,
});
meteora.AUTOPILOT = true;
meteora.trackMissionStart();
meteora.trackMissionEnd();
assert.equal(met.events.length, 2, 'Autopilot and benchmark runs do not emit player analytics');
meteora.AUTOPILOT = false;

for (const context of [ashline, alpen, tyran, meteora]) delete context.window.protocodusAnalytics;
assert.doesNotThrow(() => { ashline.analyticsStarted = false; ashline.game.status = 'playing'; ashline.trackOperationStart(); });
assert.doesNotThrow(() => alpen.trackRunStart('restart'));
assert.doesNotThrow(() => { tyran.analyticsFlight = null; tyran.trackFlightStart(); tyran.trackFlightEnd('loss'); });
assert.doesNotThrow(() => { meteora.trackMissionStart(); meteora.trackMissionEnd(); });
console.log('Game analytics checks passed: authored modes/levels, normalized difficulty, displayed score, deduplicated outcomes, retries and optional tracking.');
