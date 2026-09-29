// UI guards (DESIGN.md 16.2). (a) Hard rules: stylesheets take colours, type sizes, shadows, stacking and radii from
// tokens.css only. (b) Count guards: the words and glyphs DESIGN.md 5.4 and 6 retire may only become fewer; the counts
// live in ui-lint-baseline.json. After removing occurrences, lower the baseline with UI_LINT_WRITE=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parse } from '../tools/css-format.mjs';
import { has, ALIASES, modeGlyph } from '../ui-icons.js';

const dir = new URL('../', import.meta.url), read = name => readFileSync(new URL(name, dir), 'utf8');
const stylesheets = readdirSync(dir).filter(name => name.endsWith('.css')).sort();
const NAMED = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ');
const NAMED_RE = new RegExp(`(?<![\\w-])(${NAMED.join('|')})(?![\\w-])`, 'i');

// Every declaration in a stylesheet, with its selector and at-rule chain.
function declarations(name) {
  const out = [];
  const walk = (nodes, media) => {
    for (const node of nodes) {
      if (node.type === 'group') walk(node.children, [...media, node.prelude]);
      else if (node.type === 'rule') for (const text of node.body.replace(/\/\*[\s\S]*?\*\//g, '').split(/;(?![^(]*\))/)) {
        const colon = text.indexOf(':'); if (colon < 0) continue;
        out.push({ file: name, where: `${media.join(' ')} ${node.prelude}`.trim(), prop: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1).replace(/!\s*important/i, '').trim() });
      }
    }
  };
  walk(parse(read(name)), []);
  return out;
}
const all = stylesheets.flatMap(declarations), outside = all.filter(d => d.file !== 'tokens.css');
const report = list => list.map(d => `${d.file}: ${d.where} { ${d.prop}:${d.value} }`).join('\n');
const tokenPx = Object.fromEntries(all.filter(d => d.file === 'tokens.css' && d.prop.startsWith('--fs-')).map(d => [d.prop, parseFloat(d.value)]));

test('stylesheets other than tokens.css hold no colour literals', () => {
  const bad = outside.filter(d => /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(d.value) || NAMED_RE.test(d.value.replace(/url\([^)]*\)/g, '')));
  assert.equal(bad.length, 0, 'use a token from tokens.css:\n' + report(bad));
});

test('font sizes, shadows, stacking and radii come from tokens', () => {
  const bad = outside.filter(d =>
    (d.prop === 'font-size' && !/^(var\(--fs-[\w-]+\)|inherit|1em)$/.test(d.value)) ||
    (d.prop === 'font' && /\d(px|em|rem|%)/.test(d.value)) ||
    (d.prop === 'box-shadow' && !/^(var\(--e\d\)|none)$/.test(d.value)) ||
    (d.prop === 'z-index' && !/^(var\(--z-[\w-]+\)|0|1|auto)$/.test(d.value)) ||
    (/radius$/.test(d.prop) && !d.value.split(/\s+/).every(part => /^(var\(--r-[\w-]+\)|0|50%)$/.test(part))));
  assert.equal(bad.length, 0, 'map the value to a DESIGN.md 4 token:\n' + report(bad));
});

test('no uppercase, no positive letter-spacing and nothing under 12 px, tokens.css included', () => {
  const bad = all.filter(d =>
    (d.prop === 'text-transform' && /uppercase/i.test(d.value)) ||
    (d.prop === 'letter-spacing' && parseFloat(d.value) > 0) ||
    (d.prop === 'font-size' && (/^[\d.]+px$/.test(d.value) && parseFloat(d.value) < 12 || /^var\(--fs-[\w-]+\)$/.test(d.value) && tokenPx[d.value.slice(4, -1)] < 12)) ||
    (d.prop.startsWith('--fs-') && parseFloat(d.value) < 12));
  assert.equal(bad.length, 0, report(bad));
});

// String literals of a JS source (comments skipped); template literals contribute their text parts.
export function strings(source) {
  const out = []; let i = 0, last = '', nested = 0;
  const regexAllowed = () => /[(,=:[!&|?{};+\-*%<>~^]$|^$|\breturn$|\btypeof$|\bcase$/.test(last);
  function template() {
    let text = '', line = lineAt(i);
    for (i++; i < source.length; i++) {
      const c = source[i];
      if (c === '\\') { text += source[i + 1] || ''; i++; continue; }
      if (c === '`') { out.push({ text, line, template: true }); i++; return; }
      if (c === '$' && source[i + 1] === '{') { out.push({ text, line, template: true }); text = ''; i += 2; nested++; code(true); nested--; line = lineAt(i); i--; continue; }
      text += c;
    }
  }
  function code(inner = false) {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) i = source.length; continue; }
      if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 2; if (i < 2) i = source.length; continue; }
      if (c === '"' || c === "'") { const line = lineAt(i), start = i; let text = ''; for (i++; i < source.length && source[i] !== c; i++) { if (source[i] === '\\') { text += source[i + 1]; i++; } else text += source[i]; } const joined = /\+\s*$/.test(source.slice(Math.max(0, start - 3), start)) || /^\s*\+/.test(source.slice(i + 1, i + 4)); out.push({ text, line, quoted: true, joined, inTemplate: nested > 0 }); i++; last = 'str'; continue; }
      if (c === '`') { template(); last = 'str'; continue; }
      if (c === '/' && regexAllowed()) { let cls = false; for (i++; i < source.length; i++) { if (source[i] === '\\') { i++; continue; } if (source[i] === '[') cls = true; else if (source[i] === ']') cls = false; else if (source[i] === '/' && !cls) break; else if (source[i] === '\n') break; } i++; while (/[a-z]/i.test(source[i] || '')) i++; last = 'regex'; continue; }
      if (inner && c === '{') depth++;
      if (inner && c === '}') { if (!depth) { i++; return; } depth--; }
      if (!/\s/.test(c)) { const word = source.slice(i).match(/^[\w$]+/); if (word) { last = word[0]; i += word[0].length; continue; } last = (last + c).slice(-8); }
      i++;
    }
  }
  const lines = [0]; for (let k = 0; k < source.length; k++) if (source[k] === '\n') lines.push(k + 1);
  const lineAt = at => { let lo = 0, hi = lines.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lines[mid] <= at) lo = mid; else hi = mid - 1; } return lo + 1; };
  code();
  return out;
}

// What the count guards look for, in user-facing strings of *.js and in index.html.
export const GUARDS = {
  'middle-dot glue': /\s·\s/g,
  'arrow →': /→/g, 'arrow ↗': /↗/g, 'ellipsis •••': /•••/g, 'caret ⌃': /⌃/g, 'check ✓': /✓/g,
  'lone × close label': />\s*×\s*</g,
  "behavior:'smooth'": /behavior\s*:\s*['"]smooth['"]/g,
  'hex colour in an app.js template': /#[0-9a-fA-F]{3,8}\b/g,
};
export function occurrences() {
  const found = Object.fromEntries(Object.keys(GUARDS).map(key => [key, []]));
  const scan = (file, list, keys) => { for (const { text, line } of list) for (const key of keys) for (const match of text.matchAll(GUARDS[key])) found[key].push(`${file}:${line} ${JSON.stringify(text.length > 90 ? text.slice(Math.max(0, match.index - 40), match.index + 40) : text)}`); };
  const general = Object.keys(GUARDS).filter(key => key !== "behavior:'smooth'" && key !== 'hex colour in an app.js template');
  for (const file of readdirSync(dir).filter(name => name.endsWith('.js')).sort()) {
    const source = read(file), literals = strings(source);
    scan(file, literals, general);
    // A quoted string that is only × labels a close button; ' × ' in footprints, ×3 counts and 1.5× factors stay.
    for (const { text, line, quoted, joined } of literals) if (quoted && !joined && text === '×') found['lone × close label'].push(`${file}:${line} '×'`);
    for (const match of source.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1').matchAll(GUARDS["behavior:'smooth'"])) found["behavior:'smooth'"].push(`${file}: ${match[0]}`);
    // Template literals only: the text between backticks, expressions excluded.
    if (file === 'app.js') scan(file, literals.filter(literal => literal.template || literal.inTemplate), ['hex colour in an app.js template']);
  }
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  scan('index.html', html.split('\n').map((text, n) => ({ text, line: n + 1 })), general);
  return found;
}

test('retired words and glyphs only become fewer', () => {
  const baselineUrl = new URL('ui-lint-baseline.json', import.meta.url), found = occurrences();
  const counts = Object.fromEntries(Object.entries(found).map(([key, list]) => [key, list.length]));
  if (process.env.UI_LINT_WRITE) { writeFileSync(baselineUrl, JSON.stringify(counts, null, 2) + '\n'); return; }
  const baseline = JSON.parse(readFileSync(baselineUrl, 'utf8'));
  const risen = Object.keys(GUARDS).filter(key => counts[key] > (baseline[key] ?? 0));
  assert.deepEqual(risen, [], risen.map(key => `${key}: ${counts[key]} now, ${baseline[key] ?? 0} allowed\n  ${found[key].join('\n  ')}`).join('\n'));
});

// Icon names (DESIGN.md 5.1): the literal names given to icon(), data-icon and TOOL_INFO-style icon: fields, and the
// glyphs literal modeGlyph() calls pick. Ternary and fallback branches count; comparisons (=== 'ok') do not.
export function iconNames() {
  const found = [], lineOf = (source, at) => source.slice(0, at).split('\n').length;
  const firstArgument = (source, from) => {
    let depth = 0, quote = '';
    for (let i = from; i < source.length; i++) {
      const c = source[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (!depth) return source.slice(from, i); depth--; }
      else if (c === ',' && !depth) return source.slice(from, i);
    }
    return '';
  };
  const branches = text => [...text.matchAll(/(?:^|[?:(]|\|\||\?\?)\s*(['"])([\w-]+)\1/g)].map(match => match[2]);
  for (const file of [...readdirSync(dir).filter(name => name.endsWith('.js')).sort(), 'index.html']) {
    const source = read(file), add = (at, name) => found.push({ file, line: lineOf(source, at), name });
    for (const match of source.matchAll(/\b(?:icon|uiIcon)\(/g)) for (const name of branches(firstArgument(source, match.index + match[0].length))) add(match.index, name);
    for (const match of source.matchAll(/data-icon="([\w-]+)"/g)) add(match.index, match[1]);
    for (const match of source.matchAll(/\bicon\s*:\s*(['"])([\w-]+)\1/g)) add(match.index, match[2]);
    for (const match of source.matchAll(/\bmodeGlyph\(\s*(['"])([\w-]+)\1\s*(?:,\s*(['"])([\w-]+)\3\s*)?\)/g)) add(match.index, modeGlyph(match[2], match[4]));
  }
  return found;
}

test('every icon name in the sources is a glyph or a migration alias', () => {
  const found = iconNames(), unknown = found.filter(({ name }) => !has(name) && !has(ALIASES[name]));
  assert.ok(found.length > 60, `the scan sees the game's icons (${found.length})`);
  assert.deepEqual(unknown.map(({ file, line, name }) => `${file}:${line} ${name}`), [], 'draw it in ui-icons.js GLYPHS or fix the name');
});
