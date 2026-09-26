// Reproducible full-physics calibration. No rendering/ground scenery is present.
// node fun/tyran/tests/difficulty-balance.mjs --modes=easy --attempts=100 --workers=4
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createCampaign, beginLevel, update } from '../sim.js';
import { pilotControls, buyBalanced, PILOT_VERSION } from './balance-pilot.mjs';

const HZ = 60, CONTROL_TICKS = 6, WIDTH = 1600, HEIGHT = 900, SECTORS = 10, SECTOR_LIMIT = 600;
// Frozen before difficulty calibration. All profiles use the same 100 seeds.
export const SEEDS = Object.freeze(Array.from({ length: 100 }, (_, i) => {
  let seed = (0x54595241 + i) >>> 0;
  seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
  seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97);
  return (seed ^ (seed >>> 15)) >>> 0;
}));

function runAttempt(seed, difficulty) {
  const originalRandom = Math.random; let rng = seed;
  Math.random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  try {
    const state = createCampaign(0, null, difficulty), sectors = [];
    // Viewport is configuration; reset the new level through its normal API.
    state.width = WIDTH; state.height = HEIGHT; beginLevel(state, 0);
    let frames = 0, deaths = 0;
    while (state.status === 'playing' && sectors.length < SECTORS) {
      let ticks = 0, controls = [], sectorDeaths = 0;
      const start = { credits: state.credits, upgrades: { ...state.upgrades }, lives: state.lives };
      while (state.status === 'playing' && ticks < HZ * SECTOR_LIMIT) {
        if (ticks % CONTROL_TICKS === 0) controls = [pilotControls(state, state.players[0])];
        update(state, 1 / HZ, controls);
        sectorDeaths += state.events.filter(event => event.type === 'explosion' && event.player).length;
        state.events.length = 0; ticks++; frames++;
      }
      deaths += sectorDeaths;
      const pilot = state.players[0];
      const sector = { sector: state.level + 1, status: state.status === 'playing' ? 'timeout' : state.status,
        frames: ticks, seconds: Math.round(ticks / HZ * 100) / 100, kills: state.kills, deaths: sectorDeaths,
        earned: state.credits - start.credits, lives: state.lives, hull: Math.round(pilot.hull), shield: Math.round(pilot.shield),
        power: pilot.power, drones: pilot.drones, bombs: pilot.bombs, bossHP: Math.round(state.enemies.find(e => e.boss)?.hp || 0),
        upgrades: start.upgrades, purchases: [] };
      sectors.push(sector);
      if (state.status !== 'hangar' || sectors.length === SECTORS) break;
      sector.purchases = buyBalanced(state); beginLevel(state, state.level + 1);
    }
    const success = sectors.length === SECTORS && state.status === 'hangar';
    return { seed, difficulty, success, cleared: sectors.filter(s => s.status === 'hangar').length,
      status: success ? 'completed' : sectors.at(-1)?.status, frames, seconds: Math.round(frames / HZ * 100) / 100,
      deaths, score: state.score, credits: state.credits, totalKills: state.totalKills, sectors };
  } finally { Math.random = originalRandom; }
}

if (!isMainThread) {
  parentPort.on('message', job => {
    try { parentPort.postMessage({ index: job.index, result: runAttempt(job.seed, job.mode) }); }
    catch (error) { parentPort.postMessage({ index: job.index, error: error.stack }); }
  });
} else {
  const option = (key, fallback) => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
  const modes = option('modes', 'easy,medium,hard,real').split(',');
  const attempts = Number(option('attempts', '100')), workers = Number(option('workers', '4'));
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) throw new Error('--attempts must be 1..100 of the frozen seed list');
  if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error('--workers must be 1..16');
  const output = option('output', new URL('./balance/difficulty-results.json', import.meta.url).pathname);
  let profiles = null;
  try { profiles = (await import('../difficulty.js')).DIFFICULTIES; }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  if (modes.some(mode => !['easy', 'medium', 'hard', 'real'].includes(mode))) throw new Error('Unknown difficulty');
  if (!profiles && modes.some(mode => mode !== 'easy')) throw new Error('Non-Easy trials require the difficulty implementation');
  const sourceHashes = {};
  for (const name of ['sim.js', 'waves.js', 'difficulty.js', 'tests/balance-pilot.mjs', 'tests/difficulty-balance.mjs']) {
    try { sourceHashes[name] = createHash('sha256').update(await readFile(new URL(`../${name}`, import.meta.url))).digest('hex'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const jobs = modes.flatMap(mode => SEEDS.slice(0, attempts).map(seed => ({ mode, seed }))).map((job, index) => ({ ...job, index }));
  let next = 0, completed = 0;
  const results = Array(jobs.length), pool = [];
  const started = performance.now();
  try {
    await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, () => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url)); pool.push(worker);
      worker.on('error', reject);
      worker.on('message', data => {
        if (data.error) { reject(new Error(data.error)); return; }
        results[data.index] = data.result; completed++;
        if (completed % 10 === 0 || completed === jobs.length) console.error(`Completed ${completed}/${jobs.length} (${Math.round((performance.now() - started) / 1000)}s wall time)`);
        if (next < jobs.length) worker.postMessage(jobs[next++]); else resolve();
      });
      worker.postMessage(jobs[next++]);
    })));
  } finally { await Promise.all(pool.map(worker => worker.terminate())); }
  const summary = Object.fromEntries(modes.map(mode => {
    const runs = results.filter(r => r.difficulty === mode), wins = runs.filter(r => r.success).length;
    return [mode, { attempts: runs.length, wins, successRate: wins / runs.length, meanSectorsCleared: runs.reduce((sum, r) => sum + r.cleared, 0) / runs.length,
      meanDeaths: runs.reduce((sum, r) => sum + r.deaths, 0) / runs.length, timeouts: runs.filter(r => r.status === 'timeout').length }];
  }));
  const report = { schema: 1, method: { pilot: PILOT_VERSION, seedAlgorithm: 'Mix32(0x54595241 + attemptIndex), frozen indices 0..99; LCG1664525/1013904223 mod2^32',
    seeds: SEEDS.slice(0, attempts), physicsHz: HZ, decisionsHz: HZ / CONTROL_TICKS, viewport: { width: WIDTH, height: HEIGHT },
    success: 'A fresh sector1 run reaches the hangar after sector10, without retry; normal reserve-ship respawns and legal shop purchases are allowed.',
    sectorTimeoutSeconds: SECTOR_LIMIT, limitations: ['Deterministic artificial pilot; the measured sample is not a promise of human success rates.', 'Headless simulation omits ground scenery, its collisions, destruction rewards and ground bonus drops.', 'Pilot reads current entity positions and velocities; it cannot alter health, inventory, damage, currency, RNG outcomes or the wave director.'],
    controls: 'Nine movement choices at 10 Hz, .48s projectile prediction, visible beam/contact avoidance, nearby pickup pursuit, pulse/plasma and defensive Nova use.',
    shop: 'Buy reserve ships to 2, planned weapon tiers 2/4/5/6, one wing drone, balanced recharge/shield/hull, then Nova stock to 3.',
    calibration: 'REAL_PRESSURE is tuned against this frozen sample for 10/100 Real completions. These are calibration outcomes, not an independent validation sample.' },
    profiles, sourceHashes, summary, attempts: results };
  // Keep one complete attempt per line so a changed seed produces a useful diff.
  const { attempts: records, ...metadata } = report;
  const json = JSON.stringify(metadata, null, 2).slice(0, -2) + ',\n  "attempts": [\n'
    + records.map(record => '    ' + JSON.stringify(record)).join(',\n') + '\n  ]\n}\n';
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, json);
  console.log(JSON.stringify({ summary, wallSeconds: Math.round((performance.now() - started) / 1000), output }, null, 2));
}
