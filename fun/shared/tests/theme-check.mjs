// Run with: node fun/shared/tests/theme-check.mjs
import assert from 'node:assert/strict';
import { THEMES, dailySeed } from '../themes.js';
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

const names = Object.keys(THEMES);
assert.ok(names.length >= 6, 'A puzzle offers several distinct themes');
assert.equal(new Set(names.map((name) => THEMES[name].label)).size, names.length, 'Theme labels are unique');
assert.equal(new Set(names.map((name) => `${THEMES[name].backdrop.top}:${THEMES[name].backdrop.bottom}`)).size, names.length, 'Themes need distinct backdrops');
for (const name of names) {
  const theme = THEMES[name];
  for (const key of ['accent', 'secondary', 'clue', 'plinth', 'tileA', 'tileB', 'wall']) {
    assert.match(theme[key], /^#[\da-f]{6}$/i, `${name}: valid ${key} colour`);
  }
  for (const key of ['top', 'bottom', 'glow', 'blobA', 'blobB']) assert.match(theme.backdrop[key], /^#[\da-f]{6}$/i, `${name}: valid backdrop ${key}`);
  for (const key of ['key', 'sky', 'ground']) assert.match(theme.light[key], /^#[\da-f]{6}$/i, `${name}: valid light ${key}`);
  assert.ok(Number.isInteger(theme.motif) && theme.motif >= 0 && theme.motif <= 5, `${name}: motif names a backdrop pattern`);
  assert.ok(contrast(theme.clue, theme.tileA) >= 4.5, `${name}: clues remain readable on the first tile colour`);
  assert.ok(contrast(theme.clue, theme.tileB) >= 4.5, `${name}: clues remain readable on the second tile colour`);
  assert.ok(contrast('#0d0e12', theme.accent) >= 4.5, `${name}: the accent carries dark ink on buttons`);
  assert.equal(theme.palette.length, 12, `${name}: a dozen patch colours`);
  assert.equal(new Set(theme.palette).size, 12, `${name}: patch colours are distinct`);
  for (const colour of theme.palette) {
    assert.ok(contrast(colour, '#1a1420') >= 4.5, `${name}: placed patches preserve dark clue contrast (${colour})`);
  }
  assert.ok(theme.bokeh.length >= 3, `${name}: bokeh colours`);
  assert.ok(theme.ambient.length >= 1, `${name}: some weather`);
  for (const spec of theme.ambient) {
    if (spec.kind === 'sparks') assert.ok(spec.every[0] > 0 && spec.every[1] >= spec.every[0], `${name}: spark showers have an interval`);
    else assert.ok(spec.count > 0 && spec.size > 0 && spec.colours.length, `${name}: a cloud has dots, a size and colours`);
  }
}

const today = dailySeed(new Date(2026, 9, 24, 23, 59));
assert.equal(today, 'day20261024', 'Daily seeds use the local calendar date');
assert.equal(dailySeed(new Date(2026, 9, 25, 0, 0)), 'day20261025', 'Daily seed changes at local midnight');
assert.match(today, /^[a-z0-9]{3,16}$/, 'Daily board links use the supported seed format');
for (const generate of [zipper, patcher]) {
  assert.deepEqual(generate('medium', today), generate('medium', today), 'Daily puzzles are reproducible');
}
console.log(`Theme checks passed: ${names.length} themes with readable clues, patches and buttons, weather specs and local daily boards.`);
