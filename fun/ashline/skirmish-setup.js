// Resolve setup choices once, before world generation. Each field uses its own seed salt, so
// changing one explicit choice never rerolls another or advances the combat random stream.
import { hash, MAP_SIZES, MAP_PROFILES } from './terrain.js';
import { RACES } from './sim.js';
import { DOCTRINES, randomDoctrine } from './ai.js';
import { SKIRMISH_MODES } from './campaign.js';
import { ENVIRONMENTS } from './environments.js';

function choose(seed, field, value, values) {
  if (values.includes(value)) return value;
  return values[Math.floor(hash(`${seed}:skirmish:${field}`) / 4294967296 * values.length)];
}

export function resolveSkirmish(seed, choices = {}) {
  const size = choose(seed, 'size', choices.size, Object.keys(MAP_SIZES));
  const profile = choose(seed, 'profile', choices.profile, Object.keys(MAP_PROFILES));
  const environment = choose(seed, 'environment', choices.environment, Object.keys(ENVIRONMENTS));
  const races = ['playerRace', 'enemyRace'].map(field => choose(seed, field, choices[field], Object.keys(RACES)));
  const difficulty = choose(seed, 'difficulty', choices.difficulty, ['easy', 'normal', 'hard']);
  const mode = choose(seed, 'mode', choices.mode, SKIRMISH_MODES.map(entry => entry.id));
  // Keep the existing seed-to-commander mapping, including save restoration's concealed identity.
  const doctrine = Object.hasOwn(DOCTRINES, choices.doctrine ?? '') ? choices.doctrine : randomDoctrine(seed, 1);
  return { difficulty, mode, options: { ...MAP_SIZES[size], profile, environment, races, aiProfiles: { 1: { doctrine } } } };
}
