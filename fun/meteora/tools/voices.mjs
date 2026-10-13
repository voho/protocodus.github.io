/* Meteora — every line the game can speak, gathered for recording.

     node tools/voices.mjs        writes tools/voices/lines.json

   The radio's lines come from the missions themselves: each is flown
   headless at every difficulty, by the cheating autopilot and by the bot,
   and whatever reaches the radio is kept — scripted lines and the ones
   built from names and numbers alike. Then the wing's chatter (with every
   protected ship's name the runs met), the briefings, the recaps in both
   their versions, the prologue and the debriefs. tools/render_voices.py
   records them; js/voices.js plays a line's recording when there is one
   and falls back to the browser's speech synthesis when there is not. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { STEP as DT } from '../js/config.js';
import { MISSIONS, SPECIAL_OPS, TRAINING } from '../js/campaign.js';
import { SURVIVAL } from '../js/missions/survival.js';
import { DIFFICULTY_ORDER } from '../js/difficulty.js';
import { createWorld, startRun, stepWorld, drainEvents } from '../js/world.js';
import { PROLOGUE, RECAPS } from '../js/story.js';
import { SHOT_DOWN } from '../js/screens.js';
import { LINES as CHATTER } from '../js/chatter.js';
import { speakable, voiceKey } from '../js/voices.js';
import { play } from '../tests/autopilot.mjs';
import { createBot } from '../tests/bot.mjs';

const lines = new Map();
const add = (who, text, where, kind) => {
  if (!text || !who || who === 'you') return;
  const key = voiceKey(who, text);
  const line = lines.get(key) ?? { key, who, text: speakable(text), kind, missions: [] };
  if (where && !line.missions.includes(where)) line.missions.push(where);
  lines.set(key, line);
};
const protect = new Set();
const watch = (world) => {
  for (const e of world.entities) if (e.team === 0 && e.alive && (e.tags.has('objective') || e.tags.has('convoy') || e.big)) protect.add(e.name);
};

for (const mission of [...MISSIONS, ...SPECIAL_OPS, TRAINING, SURVIVAL]) {
  const id = mission.id;
  const t0 = performance.now();
  for (const difficulty of DIFFICULTY_ORDER) {
    // The cheat pilot finishes everything; the bot fights it out and fails
    // now and then, which has lines of its own.
    if (mission !== SURVIVAL) {
      let steps = 0;
      const r = play(mission, { difficulty, loadout: mission.recommend, seconds: 1500, onStep: w => { if (steps++ % 240 === 0) watch(w); } });
      for (const l of r.world.mission.radio) add(l.who, l.text, id, 'radio');
    }
    for (const k of [0, 1]) {
      const def = { ...mission, seed: (mission.seed ?? 1) + k * 101, create: w => mission.create(w) };
      const world = createWorld({ seed: 1, mission: def, loadout: mission.recommend ?? { hull: 'kestrel', primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor: 'hearth' }, difficulty });
      startRun(world);
      const bot = createBot(7 + k * 13);
      for (let t = 0; t < (mission === SURVIVAL ? 600 : 1500) && !world.mission.outcome; t += DT) {
        stepWorld(world, bot(world, DT), DT);
        if ((t * 120 | 0) % 120 === 0) { drainEvents(world); watch(world); }
      }
      for (let k2 = 0; k2 < 240; k2++) stepWorld(world, bot(world, DT), DT);
      for (const l of world.mission.radio) add(l.who, l.text, id, 'radio');
    }
  }
  // What is read out of flight: the briefing, the recap, the debrief.
  for (const s of mission.briefing?.stages ?? []) add(s.who ?? 'doukas', s.text, id, 'brief');
  if (RECAPS[id]) for (const has of [() => true, () => false]) add('narrator', RECAPS[id](has), id, 'story');
  if (mission.debrief) {
    for (const k of ['won', 'lost', 'died']) add('narrator', mission.debrief[k], id, 'story');
    if (!mission.debrief.died) add('narrator', SHOT_DOWN, id, 'story');
  }
  console.log(`${id.padEnd(9)} ${String([...lines.values()].filter(l => l.missions.includes(id)).length).padStart(4)} lines  ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
add('narrator', 'The waves never stop. How long can you last?', 'survival', 'story');
for (const p of PROLOGUE) add('narrator', p.text, 'menu', 'story');
// The wing's chatter, every mission's protected ships named.
for (const [kind, byWho] of Object.entries(CHATTER)) {
  for (const [who, list] of Object.entries(byWho)) {
    for (const text of list) {
      if (text.includes('{name}')) for (const name of protect) add(who, text.replace('{name}', name), 'chatter', 'radio');
      else add(who, text, 'chatter', 'radio');
    }
  }
}

const all = [...lines.values()].sort((a, b) => a.key.localeCompare(b.key));
mkdirSync(new URL('./voices/', import.meta.url), { recursive: true });
writeFileSync(new URL('./voices/lines.json', import.meta.url), JSON.stringify(all, null, 1));
const chars = all.reduce((n, l) => n + l.text.length, 0);
console.log(`${all.length} lines, ${chars} characters (about ${Math.round(chars / 14 / 60)} minutes spoken); ${protect.size} protected names`);
