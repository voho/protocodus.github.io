import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, updateGame} from '../sim.js';
import {encodeGame, decodeGame} from '../save.js';
import {ENVIRONMENTS, environmentFor} from '../environments.js';

const compact = {width:72, height:56};

test('every environment survives a save and continues the same simulation', () => {
  for (const environment of Object.keys(ENVIRONMENTS)) {
    const original = createGame('BIOME-SAVE', 'normal', {...compact, environment});
    for (let i = 0; i < 12; i++) updateGame(original, .25);
    const restored = decodeGame(encodeGame(original)).game;
    assert.equal(restored.environment, environment);
    for (let i = 0; i < 12; i++) {
      updateGame(original, .25);
      updateGame(restored, .25);
    }
    assert.deepEqual(JSON.parse(encodeGame(restored)).game, JSON.parse(encodeGame(original)).game);
  }
});

test('environments keep seeded terrain, resources, navigation and combat randomness intact', () => {
  const baseline = createGame('BIOME-FAIR', 'normal', compact);
  for (const environment of Object.keys(ENVIRONMENTS)) {
    const state = createGame('BIOME-FAIR', 'normal', {...compact, environment});
    for (const key of ['terrain', 'minerals', 'mineralTypes', 'blocked', 'regions', 'entities', 'rng', 'layout']) {
      assert.deepEqual(state[key], baseline[key], `${environment}: ${key} remains identical`);
    }
  }
});

test('older saves retain ash scenery, while unsupported environments are rejected', () => {
  const data = JSON.parse(encodeGame(createGame('OLD-ASH', 'normal', compact)));
  delete data.game.environment;
  assert.equal(decodeGame(JSON.stringify(data)).game.environment, 'ash');
  assert.deepEqual(environmentFor({}), environmentFor({environment:'ash'}));
  data.game.environment = 'unknown';
  assert.throws(() => decodeGame(JSON.stringify(data)), /damaged or incompatible/);
  data.game.environment = ['ash'];
  assert.throws(() => decodeGame(JSON.stringify(data)), /damaged or incompatible/);
  assert.throws(() => createGame('BAD-BIOME', 'normal', {...compact, environment:'unknown'}), /Unsupported environment/);
});
