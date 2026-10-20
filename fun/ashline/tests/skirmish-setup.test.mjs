import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSkirmish } from '../skirmish-setup.js';
import { MAP_SIZES, MAP_PROFILES } from '../terrain.js';
import { ENVIRONMENTS } from '../environments.js';
import { RACES } from '../sim.js';
import { randomDoctrine } from '../ai.js';
import { SKIRMISH_MODES } from '../campaign.js';

test('Random setup is repeatable from the sector seed and resolves every field', () => {
  const choice = resolveSkirmish('ALL-RANDOM');
  assert.deepEqual(choice, resolveSkirmish('ALL-RANDOM'));
  assert(['easy', 'normal', 'hard'].includes(choice.difficulty));
  assert(SKIRMISH_MODES.some(mode => mode.id === choice.mode));
  assert(Object.values(MAP_SIZES).some(size => size.width === choice.options.width && size.height === choice.options.height));
  assert(Object.hasOwn(MAP_PROFILES, choice.options.profile));
  assert(Object.hasOwn(ENVIRONMENTS, choice.options.environment));
  assert(choice.options.races.every(race => Object.hasOwn(RACES, race)));
  assert.equal(choice.options.aiProfiles[1].doctrine, randomDoctrine('ALL-RANDOM', 1));
  assert(!JSON.stringify(choice).includes('"random"'));
});

test('each explicit choice is honored without rerolling the other fields', () => {
  const seed = 'PARTIAL-RANDOM', original = resolveSkirmish(seed);
  const expected = structuredClone(original);
  expected.options.environment = 'jungle';
  assert.deepEqual(resolveSkirmish(seed, { environment: 'jungle' }), expected);
  assert.deepEqual(resolveSkirmish(seed, {
    size: 'standard', profile: 'basin', environment: 'desert', playerRace: 'aiUnity', enemyRace: 'organics',
    difficulty: 'easy', mode: 'relay', doctrine: 'swarm',
  }), {
    difficulty: 'easy', mode: 'relay', options: { ...MAP_SIZES.standard, profile: 'basin', environment: 'desert',
      races: ['aiUnity', 'organics'], aiProfiles: { 1: { doctrine: 'swarm' } } },
  });
});

test('a range of sector seeds reaches every available random option', () => {
  const fields = Object.fromEntries(['difficulty', 'mode', 'size', 'profile', 'environment', 'playerRace', 'enemyRace'].map(key => [key, new Set()]));
  for (let i = 0; i < 512; i++) {
    const setup = resolveSkirmish(`SECTOR-${i}`), options = setup.options;
    for (const [key, value] of Object.entries({
      difficulty: setup.difficulty, mode: setup.mode, size: `${options.width}x${options.height}`, profile: options.profile,
      environment: options.environment, playerRace: options.races[0], enemyRace: options.races[1],
    })) fields[key].add(value);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([key, values]) => [key, values.size])), {
    difficulty: 3, mode: SKIRMISH_MODES.length, size: Object.keys(MAP_SIZES).length, profile: Object.keys(MAP_PROFILES).length,
    environment: Object.keys(ENVIRONMENTS).length, playerRace: Object.keys(RACES).length, enemyRace: Object.keys(RACES).length,
  });
});
