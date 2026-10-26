// Run with: node tests/game-analytics-check.mjs
// Run the browser entrypoints' real analytics/lifecycle functions with small
// rendering stubs, while using the games' actual definitions and score logic.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { CAMPAIGN, MISSIONS, SKIRMISH_MODES } from '../fun/ashline/campaign.js';
import { createGame } from '../fun/ashline/sim.js';
import { matchReport } from '../fun/ashline/debrief.js';
import { DIFFICULTY } from '../fun/hedgerow/js/config.js';
import LEVEL from '../fun/hedgerow/js/levels/saint-clair.js';
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

// Hedgerow's difficulty is normalized against its real settings table and its
// checkpoint is a bounded authored index. Exercise the real retry callback.
const hedge = collector();
const clearable = { clear: noop };
const hedgerow = await functions('fun/hedgerow/js/main.js', ['analyticsAttemptContext', 'trackAttemptStart', 'trackAttemptEnd', 'retryCheckpoint'], {
  ...hedge, LEVEL, DIFFICULTY, settings: { difficulty: 'veteran' },
  mission: { checkpoint: 0, restoreCheckpoint: () => ({ spawn: LEVEL.start, inventory: null }) },
  missionTime: 0, analyticsAttemptActive: false, analyticsAttemptStart: 0,
  fade: { classList: { add: noop, remove: noop } }, explosives: clearable,
  G: { debris: clearable, casings: clearable, chunks: clearable, steam: clearable },
  enemies: { resetLiving: noop }, player: { reset: noop }, resume: noop,
  setTimeout: callback => callback(),
});
hedgerow.trackAttemptStart();
assert.deepEqual(hedge.events[0], {
  event: 'game_start', game_name: 'hedgerow', game_mode: 'mission', level: LEVEL.id,
  difficulty: 'veteran', checkpoint: 0, action: 'mission_start',
});
hedgerow.missionTime = 20;
hedgerow.trackAttemptEnd('loss', NaN);
hedgerow.trackAttemptEnd('loss');
assert.equal(hedge.events.length, 2, 'Repeated Hedgerow death cannot duplicate its outcome');
assert.equal(hedge.events[1].duration_seconds, 20);
assert.equal('score' in hedge.events[1], false, 'Non-finite scores are omitted');
hedgerow.mission.checkpoint = 3;
hedgerow.retryCheckpoint();
assert.equal(hedge.events[2].action, 'checkpoint_retry');
assert.equal(hedge.events[2].checkpoint, 3);
hedgerow.missionTime = 27;
hedgerow.trackAttemptEnd('win', 400);
assert.equal(hedge.events[3].duration_seconds, 7, 'Checkpoint retry starts its own duration');
assert.equal(hedge.events[3].score, 400);
hedgerow.settings.difficulty = 'unexpected private setting';
hedgerow.mission.checkpoint = LEVEL.checkpoints.length;
assert.equal(hedgerow.analyticsAttemptContext().difficulty, 'regular');
assert.equal(hedgerow.analyticsAttemptContext().checkpoint, 0, 'Out-of-range checkpoint is normalized');

// Alpen has no finite levels or difficulty. Its authored chapter is the useful
// context; pausing must not become a new drop-in and an explicit restart must.
const alpine = collector();
const alpen = await functions('fun/alpen/js/main.js', ['trackRunStart', 'begin', 'restartRun'], {
  ...alpine, chapterNameAt, rider: { pos: { z: -200 } }, game: { mode: 'attract' },
  audio: { start: noop, muted: false }, showMuted: noop,
  bootReady: false, contextLost: false, runStarted: false,
  curtainPointers: new Set(), curtainClickReady: false,
  curtain: { classList: { remove: noop } }, retro: { fade: noop }, pausedRendered: false,
});
alpen.restart = fullReset => { alpen.rider.pos.z = fullReset ? 0 : -4000; };
alpen.begin();
assert.equal(alpine.events.length, 0, 'Loading and attract-mode previews do not count as starts');
alpen.bootReady = true;
alpen.begin();
assert.deepEqual(alpine.events[0], {
  event: 'game_start', game_name: 'alpen', game_mode: 'freeride', level: chapterNameAt(0), action: 'drop_in',
});
alpen.game.mode = 'paused';
alpen.begin();
assert.equal(alpine.events.length, 1, 'Resuming Alpen does not create another drop-in');
alpen.restartRun();
assert.equal(alpine.events[1].action, 'restart');
assert.equal(alpine.events[1].level, chapterNameAt(-4000));
assert.equal('seed' in alpine.events[1], false);

for (const context of [ashline, hedgerow, alpen]) delete context.window.protocodusAnalytics;
assert.doesNotThrow(() => { ashline.analyticsStarted = false; ashline.game.status = 'playing'; ashline.trackOperationStart(); });
assert.doesNotThrow(() => { hedgerow.trackAttemptStart(); hedgerow.trackAttemptEnd('win'); });
assert.doesNotThrow(() => alpen.trackRunStart('restart'));
console.log('Game analytics checks passed: authored modes/levels, normalized difficulty/checkpoints, displayed score, deduplicated outcomes, retries and optional tracking.');
