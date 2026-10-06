import test from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS, ALIASES, icon, has, names, modeGlyph } from '../ui-icons.js';

// DESIGN.md 5.2, every group.
const VOCABULARY = {
  navigation: ['build', 'routes', 'gallery', 'town', 'industry', 'news', 'menu', 'guide', 'chains', 'overview', 'layers', 'company', 'achievements', 'saved', 'world', 'sound', 'soundOff', 'search', 'keyboard'],
  actions: ['close', 'plus', 'minus', 'locate', 'chevronRight', 'chevronLeft', 'chevronDown', 'chevronUp', 'more', 'edit', 'retire', 'undo', 'swap', 'check', 'pause', 'play'],
  states: ['ok', 'warn', 'error', 'broken', 'info', 'lock', 'clock', 'trendUp', 'trendDown'],
  things: ['bus', 'truck', 'train', 'ship', 'plane', 'stop', 'flag', 'stock', 'coin', 'house', 'shop', 'workshop', 'tree', 'leaf', 'label'],
  tools: ['road', 'rail', 'bridge', 'tunnel', 'bulldoze', 'raise', 'lower', 'level', 'zones', 'pointer'],
  weather: ['sun', 'cloud', 'rain', 'snow', 'fog'],
  biomes: ['taiga', 'tundra', 'desert'],
};

// Every point a glyph's markup names: path vertices and control points, circle, ellipse and rect extents, line ends.
function points(markup) {
  const out = [], attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
  for (const [, name, body] of markup.matchAll(/<(\w+)([^>]*)\/?>/g)) {
    const a = attrs(body), n = key => Number(a[key] ?? 0);
    if (name === 'circle') out.push([n('cx') - n('r'), n('cy') - n('r')], [n('cx') + n('r'), n('cy') + n('r')]);
    else if (name === 'ellipse') out.push([n('cx') - n('rx'), n('cy') - n('ry')], [n('cx') + n('rx'), n('cy') + n('ry')]);
    else if (name === 'rect') out.push([n('x'), n('y')], [n('x') + n('width'), n('y') + n('height')]);
    else if (name === 'line') out.push([n('x1'), n('y1')], [n('x2'), n('y2')]);
    else if (name === 'path') {
      let x = 0, y = 0, sx = 0, sy = 0;
      for (const [, command, args] of a.d.matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g)) {
        const v = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) || []).map(Number), rel = command === command.toLowerCase(), c = command.toUpperCase();
        const size = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }[c];
        if (c === 'Z') { x = sx; y = sy; continue; }
        for (let i = 0; i < v.length; i += size) {
          const g = v.slice(i, i + size), bx = rel ? x : 0, by = rel ? y : 0;
          if (c === 'H') x = bx + g[0];
          else if (c === 'V') y = by + g[0];
          else if (c === 'A') { x = bx + g[5]; y = by + g[6]; }
          else { for (let k = 0; k < size - 2; k += 2) out.push([bx + g[k], by + g[k + 1]]); x = bx + g[size - 2]; y = by + g[size - 1]; }
          out.push([x, y]);
          if (c === 'M' && i === 0) { sx = x; sy = y; }
        }
      }
    }
  }
  return out;
}

test('DESIGN.md 5.2 vocabulary is drawn in full, plus the map grid layer', () => {
  const expected = [...Object.values(VOCABULARY).flat(), 'grid'];
  assert.deepEqual(expected.filter(name => !has(name)), []);
  assert.deepEqual(names().filter(name => !expected.includes(name)), [], 'no glyph outside the vocabulary');
  assert.equal(new Set(names()).size, names().length);
});

test('every glyph renders a 24-unit svg with its size class and hidden or labelled semantics', () => {
  for (const name of names()) {
    const svg = icon(name);
    assert.match(svg, /^<svg class="i i20" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">.+<\/svg>$/, name);
  }
  assert.match(icon('close', { size: 16, cls: 'x-close' }), /^<svg class="i i16 x-close" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">/);
  const labelled = icon('warn', { size: 24, label: 'Needs "care" & <attention>' });
  assert.match(labelled, /^<svg class="i i24" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="Needs &quot;care&quot; &amp; &lt;attention&gt;">/);
  assert.ok(!labelled.includes('aria-hidden'));
});

test('every coordinate stays inside the 2-unit inset', () => {
  for (const [name, markup] of Object.entries(GLYPHS)) {
    const list = points(markup);
    assert.ok(list.length >= 2, `${name} has geometry`);
    const outside = list.filter(([x, y]) => !(x >= 2 - 1e-9 && x <= 22 + 1e-9 && y >= 2 - 1e-9 && y <= 22 + 1e-9));
    assert.deepEqual(outside, [], `${name} stays within 2..22`);
  }
});

test('markup carries no paint attributes; only pause and play are solid, dots are small', () => {
  for (const [name, markup] of Object.entries(GLYPHS)) {
    assert.doesNotMatch(markup, /\s(fill|stroke|stroke-[\w-]+|style|transform|opacity)=/, `${name} leaves paint to CSS`);
    assert.doesNotMatch(markup, /<(?!\/)(?!(path|circle|rect|ellipse|line)\b)/, `${name} uses plain shapes`);
    assert.equal(/class="solid"/.test(markup), name === 'pause' || name === 'play', `${name} solid parts`);
    for (const [, r] of markup.matchAll(/<circle[^>]*r="([\d.]+)"[^>]*class="dot"/g)) assert.ok(Number(r) <= 1.25, `${name} dots stay dots`);
    for (const [, cls] of markup.matchAll(/class="([^"]*)"/g)) assert.ok(cls === 'solid' || cls === 'dot', `${name} class ${cls}`);
    for (const [, rx] of markup.matchAll(/<rect[^>]*rx="([\d.]+)"/g)) assert.ok(Number(rx) <= 2, `${name} rect corners`);
  }
});

test('an unknown name throws in development and renders nothing in production', () => {
  const error = console.error, logged = [];
  try {
    globalThis.TRANSPORT_DEV = true;
    assert.throws(() => icon('factoryy'), /Unknown icon: factoryy/);
    delete globalThis.TRANSPORT_DEV;
    console.error = (...args) => logged.push(args.join(' '));
    assert.equal(icon('nope'), '');
    assert.equal(icon('nope'), '');
    assert.equal(icon('also-nope'), '');
    assert.deepEqual(logged.map(line => line.includes('nope')), [true, true], 'one report per unknown name');
  } finally { delete globalThis.TRANSPORT_DEV; console.error = error; }
});

test('aliases point at real glyphs and render them during the migration', () => {
  assert.ok(Object.isFrozen(ALIASES) && Object.isFrozen(GLYPHS));
  for (const [from, to] of Object.entries(ALIASES)) { assert.ok(has(to), `${from} -> ${to}`); assert.ok(!has(from), `${from} is retired, not a glyph`); }
  for (const [from, to] of [['city', 'town'], ['factory', 'industry'], ['arrowup', 'trendUp'], ['medal', 'achievements'], ['help', 'guide'], ['route', 'routes'], ['warning', 'warn'], ['focus', 'locate']]) {
    assert.equal(ALIASES[from], to);
    assert.equal(icon(from), icon(to));
  }
});

test('modeGlyph picks the vehicle for a mode and cargo', () => {
  assert.equal(modeGlyph('road', 'passengers'), 'bus');
  assert.equal(modeGlyph('road', 'mail'), 'bus');
  assert.equal(modeGlyph('road', 'coal'), 'truck');
  assert.equal(modeGlyph('road', 'goods'), 'truck');
  assert.equal(modeGlyph('rail', 'passengers'), 'train');
  assert.equal(modeGlyph('rail', 'coal'), 'train');
  assert.equal(modeGlyph('water', 'oil'), 'ship');
  assert.equal(modeGlyph('water', 'passengers'), 'ship');
  assert.equal(modeGlyph('air', 'mail'), 'plane');
  assert.equal(modeGlyph('air'), 'plane');
  for (const mode of ['road', 'rail', 'water', 'air']) for (const cargo of [undefined, 'passengers', 'coal']) assert.ok(has(modeGlyph(mode, cargo)));
});
