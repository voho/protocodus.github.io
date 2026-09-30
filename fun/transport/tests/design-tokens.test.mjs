import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLORS, STATES, LINE_COLORS, TIERS, FONT, MAP, alpha } from '../design-tokens.js';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
// Every custom property set by a top-level :root rule of tokens.css (media overrides aside).
const tokens = (() => {
  const css = read('tokens.css').replace(/\/\*[\s\S]*?\*\//g, ''), out = {};
  let depth = 0, from = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (!depth) { const prelude = css.slice(from, i).trim(); if (prelude === ':root') { const end = css.indexOf('}', i); for (const [, name, value] of css.slice(i + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out[name] = value.trim(); } } depth++; }
    else if (css[i] === '}') { depth--; if (!depth) from = i + 1; }
  }
  return out;
})();
const kebab = name => name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
const same = value => String(value).replace(/\s+/g, '').toLowerCase();
const token = (name, value) => { assert.ok(name in tokens, `tokens.css defines ${name}`); assert.equal(same(tokens[name]), same(value), `${name} matches design-tokens.js`); };

test('surface, ink and signal colours match between tokens.css and design-tokens.js', () => {
  for (const [key, value] of Object.entries(COLORS)) token('--' + kebab(key), value);
  assert.equal(COLORS.onInk, COLORS.paper, 'text on ink is paper');
});

test('state colours match on paper and on ink', () => {
  for (const name of ['ok', 'warn', 'error']) { token(`--${name}`, STATES[name].color); token(`--${name}-on-ink`, STATES[name].onInk); }
  assert.equal(STATES.paused.color, COLORS.ink2);
  assert.equal(STATES.info.color, COLORS.ink);
});

test('nine line colours alternate deep and light, with white or ink numerals, and none is green, teal or orange', () => {
  assert.equal(LINE_COLORS.length, 9);
  assert.deepEqual(LINE_COLORS.map(line => line.name), ['Cobalt', 'Marigold', 'Crimson', 'Cornflower', 'Plum', 'Heather', 'Umber', 'Iris', 'Graphite']);
  LINE_COLORS.forEach((line, i) => { token(`--line-${i + 1}`, line.fill); token(`--line-${i + 1}-on`, line.on); assert.equal(line.on, i % 2 ? COLORS.ink : '#FFFFFF'); });
  const hue = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), d = max - Math.min(r, g, b); if (!d) return -1; const h = max === r ? (g - b) / d % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  for (const line of LINE_COLORS) { const h = hue(line.fill); assert.ok(!(h >= 80 && h < 200), `${line.name} is not green or teal`); assert.ok(!(h >= 15 && h < 30), `${line.name} is not signal orange`); }
});

test('achievement tiers, type, weights and tracking match', () => {
  for (const [key, value] of Object.entries(TIERS)) token(`--tier-${key}`, value);
  token('--font', FONT.family);
  token('--font-brand', FONT.brand);
  for (const [step, px] of Object.entries(FONT.size)) { token(`--fs-${step}`, px + 'px'); token(`--lh-${step}`, FONT.line[step] + 'px'); }
  assert.ok(Object.values(FONT.size).every(px => px >= 12), 'nothing is smaller than 12 px');
  for (const [key, value] of Object.entries(FONT.weight)) token(`--fw-${key}`, value);
  for (const [key, value] of Object.entries(FONT.tracking)) token(`--tr-${key}`, value);
});

test('tokens.css carries every DESIGN.md 4 group: space, sizes, radii, elevation, stacking, focus and motion', () => {
  const expect = { '--s-1': '4px', '--s-6': '32px', '--control': '32px', '--control-dense': '28px', '--control-touch': '44px', '--rail-h': '48px', '--goal-h': '40px', '--tabbar-h': '56px', '--drawer-w': '400px', '--inspector-w': '368px', '--toast-max': '480px', '--gutter': '12px',
    '--r-1': '4px', '--r-2': '6px', '--r-3': '8px', '--r-4': '12px', '--r-5': '14px', '--r-round': '999px',
    '--e1': '0 1px 2px rgb(20 35 25 / .18),0 0 0 1px rgb(20 35 25 / .08)', '--e4': '0 28px 70px -12px rgb(15 27 21 / .40)',
    '--z-map': '0', '--z-map-overlay': '10', '--z-rail': '20', '--z-goal': '22', '--z-sheet': '30', '--z-toolbar': '34', '--z-toast': '40', '--z-headline': '42', '--z-popover': '50', '--z-tooltip': '55', '--z-dialog': '60', '--z-loading': '70',
    '--t-quick': '120ms', '--t-toast': '160ms', '--t-panel': '180ms', '--t-row': '160ms', '--t-meter': '300ms', '--t-tint': '600ms', '--ease': 'cubic-bezier(.2,.7,.2,1)' };
  for (const [name, value] of Object.entries(expect)) token(name, value);
  const z = Object.entries(tokens).filter(([name]) => name.startsWith('--z-')).map(([, value]) => +value);
  assert.deepEqual(z, [...z].sort((a, b) => a - b), 'stacking tokens rise from the map to the loading screen');
  assert.ok(+tokens['--z-toast'] < +tokens['--z-popover'], 'toasts sit below menus');
});

test('map marks draw with the shared colours', () => {
  assert.equal(MAP.nameplate.fill, COLORS.paper); assert.equal(MAP.nameplate.fillAlpha, .94); assert.equal(MAP.nameplate.edgeAlpha, .14);
  assert.equal(MAP.roundel.ringWidth, 2.5); assert.equal(MAP.selection.color, COLORS.signal); assert.equal(MAP.selection.casingWidth, 5);
  assert.equal(MAP.hover.alpha, .85); assert.equal(MAP.reach.casingAlpha, .35); assert.equal(MAP.cut.color, STATES.error.color);
  assert.ok([MAP.nameplate.name.size, MAP.nameplate.population.size, MAP.bullet.numeral.size].every(px => px >= 12));
  assert.equal(alpha(COLORS.paper, .94), 'rgba(247,246,239,0.94)');
});

test('design-tokens.js stays DOM-free', () => {
  const source = read('design-tokens.js');
  assert.doesNotMatch(source, /\b(document|window|getComputedStyle|localStorage)\b/);
  assert.doesNotMatch(source, /^\s*import\b/m);
});
