/* Meteora — balance runs: the bot (tests/bot.mjs) plays every campaign
   mission several times at each difficulty, with the recommended loadout
   or another, and reports win rates, why it lost, how long it took, how
   much hull it lost and how many bonuses it took.

     node tools/balance.mjs [m03] [--runs 3] [--diff pilot,ace] [--hull swift --primary pulse ...]

   --idle plays every mission with nobody at the stick: the player cannot
   be hurt and the Harrow ignore it. A mission that still wins that way at
   Pilot or above does not need the player, which is a design bug.
*/
import { STEP as DT } from '../js/config.js';
import { MISSIONS, SPECIAL_OPS } from '../js/campaign.js';
import { createWorld, startRun, stepWorld, drainEvents } from '../js/world.js';
import { results } from '../js/mission.js';
import { createBot } from '../tests/bot.mjs';
import { IDLE } from '../js/world.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const only = args.filter(a => /^m\d\d$/.test(a));
const idle = args.includes('--idle');
// An idle win rate needs many seeds to mean anything: 8 by default.
const runs = Number(opt('runs', idle ? 8 : 3));
const diffs = opt('diff', 'recruit,pilot,veteran,ace').split(',');
const override = ['hull', 'primary', 'reactor'].reduce((o, k) => (opt(k) ? { ...o, [k]: opt(k) } : o), {});
const secs = opt('secondaries');
if (secs) override.secondaries = secs.split('+');

export function playOnce(mission, difficulty, loadout, k, { idle = false } = {}) {
  // The mission's own seed, shifted per run, drives the world.
  const def = { ...mission, seed: (mission.seed ?? 1) + k * 101, create: w => mission.create(w) };
  const world = createWorld({ seed: 1, mission: def, loadout, difficulty });
  startRun(world);
  const bot = idle ? () => IDLE : createBot(7 + k * 13);
  if (idle) { world.player.invulnerable = true; world.player.untargetable = true; }
  let t = 0;
  while (t < 1500 && !world.mission.outcome) {
    stepWorld(world, bot(world, DT), DT);
    t += DT;
    if ((t * 120 | 0) % 120 === 0) drainEvents(world);
  }
  const r = results(world);
  return { won: r.won, reason: r.reason, time: r.time, hull: world.player.hull / world.player.maxHull, bonus: `${r.bonusDone}/${r.bonusTotal}`, kills: r.stats.killCount, deadEnd: world.state === 'dead' };
}

if (process.argv[1]?.endsWith('balance.mjs')) {
  for (const mission of [...MISSIONS, ...SPECIAL_OPS].filter(m => !only.length || only.includes(m.id))) {
    const loadout = { ...mission.recommend, ...override };
    const line = [`${mission.id} ${mission.title.padEnd(20)}`];
    for (const d of diffs) {
      const out = [];
      const t0 = performance.now();
      for (let k = 0; k < runs; k++) out.push(playOnce(mission, d, loadout, k, { idle }));
      const wins = out.filter(o => o.won).length;
      const why = out.filter(o => !o.won).map(o => (o.deadEnd ? 'died' : (o.reason ?? 'timeout')).slice(0, 38));
      line.push(`${d}: ${wins}/${runs} (${(out.reduce((s, o) => s + o.time, 0) / runs).toFixed(0)}s, hull ${(out.reduce((s, o) => s + o.hull, 0) / runs * 100).toFixed(0)}%, kills ${(out.reduce((s, o) => s + o.kills, 0) / runs).toFixed(0)}, bonus ${out.map(o => o.bonus).join(' ')})${why.length ? ` [${why.join('; ')}]` : ''} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
    }
    console.log(line.join('\n   '));
  }
}
