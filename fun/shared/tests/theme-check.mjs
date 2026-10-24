// Run with: node fun/shared/tests/theme-check.mjs
import assert from 'node:assert/strict';
import { WORLDS, themeFor, dailySeed } from '../themes.js';
import { generate as zipper } from '../../zipper/js/puzzle.js';
import { generate as patcher } from '../../patcher/js/puzzle.js';

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => {
    const s = parseInt(value, 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

assert.ok(WORLDS.length >= 4, 'A new puzzle should offer several distinct worlds');
assert.equal(new Set(WORLDS.map(({ id }) => id)).size, WORLDS.length, 'World identities must be unique');
assert.equal(new Set(WORLDS.map(({ top, bottom }) => `${top}:${bottom}`)).size, WORLDS.length, 'Worlds need distinct backdrops');
for (const world of WORLDS) {
  for (const key of ['accent', 'secondary', 'top', 'bottom', 'tileA', 'tileB', 'plinth', 'wall', 'clue']) {
    assert.match(world[key], /^#[\da-f]{6}$/i, `${world.id}: valid ${key} colour`);
  }
  assert.ok(contrast(world.clue, world.tileA) >= 4.5, `${world.id}: clues remain readable on the first tile colour`);
  assert.ok(contrast(world.clue, world.tileB) >= 4.5, `${world.id}: clues remain readable on the second tile colour`);
  for (const colour of world.palette) {
    assert.ok(contrast(colour, '#1a1420') >= 4.5, `${world.id}: placed patches preserve dark clue contrast`);
  }
}
for (const game of ['zipper', 'patcher']) {
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    const seed = `scenery${i}`;
    const world = themeFor(seed, game);
    assert.ok(WORLDS.includes(world), `${game}: selected world is supported`);
    assert.deepEqual(themeFor(seed, game), world, `${game}: a shared puzzle link preserves scenery`);
    seen.add(world.id);
  }
  assert.equal(seen.size, WORLDS.length, `${game}: every world is reachable across puzzle seeds`);
}

const today = dailySeed(new Date(2026, 9, 24, 23, 59));
assert.equal(today, 'day20261024', 'Daily seeds use the local calendar date');
assert.equal(dailySeed(new Date(2026, 9, 25, 0, 0)), 'day20261025', 'Daily seed changes at local midnight');
assert.match(today, /^[a-z0-9]{3,16}$/, 'Daily board links use the supported seed format');
for (const generate of [zipper, patcher]) {
  assert.deepEqual(generate('medium', today), generate('medium', today), 'Daily puzzles are reproducible');
}
console.log(`Theme checks passed: ${WORLDS.length} reachable worlds, deterministic scenery, readable palettes and local daily boards.`);
