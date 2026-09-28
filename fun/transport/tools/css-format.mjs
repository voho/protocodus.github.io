#!/usr/bin/env node
// One rule per line for every stylesheet: at-rule headers on their own line, inner rules one per line
// (indented by a space), each closing brace alone on its line. Only whitespace between rules changes.
//   node fun/transport/tools/css-format.mjs            rewrite every fun/transport/*.css
//   node fun/transport/tools/css-format.mjs --check    exit non-zero when a file is not formatted
//   node fun/transport/tools/css-format.mjs --verify   compare every sheet's cssRules before and after, in Chrome
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// At-rules whose blocks hold rules rather than declarations.
const GROUPS = /^@(media|supports|container|layer|keyframes|-webkit-keyframes|document|scope|starting-style)\b/i;

// Skips a comment or string starting at i; returns the index after it, or i when there is none.
function skip(text, i) {
  if (text[i] === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); return end < 0 ? text.length : end + 2; }
  if (text[i] === '"' || text[i] === "'") { const quote = text[i]; for (let j = i + 1; j < text.length; j++) { if (text[j] === '\\') j++; else if (text[j] === quote) return j + 1; } return text.length; }
  return i;
}

// Parses a stylesheet into comments, blank lines, statements, rules {prelude, body} and groups {prelude, children}.
// Preludes and bodies keep their text exactly, apart from the whitespace around them.
export function parse(text) {
  let i = 0;
  const block = () => {
    const nodes = [];
    while (i < text.length) {
      const start = i;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (/\n[^\S\n]*\n/.test(text.slice(start, i)) && nodes.length && nodes.at(-1).type !== 'blank') nodes.push({ type: 'blank' });
      if (i >= text.length) break;
      if (text[i] === '}') { i++; return nodes; }
      if (text[i] === '/' && text[i + 1] === '*') { const end = skip(text, i); nodes.push({ type: 'comment', text: text.slice(i, end) }); i = end; continue; }
      const from = i;
      while (i < text.length && text[i] !== '{' && text[i] !== ';' && text[i] !== '}') { const next = skip(text, i); i = next > i ? next : i + (text.slice(i, i + 4).toLowerCase() === 'url(' ? url(i) : 1); }
      const prelude = text.slice(from, i).trim();
      if (text[i] === ';' || text[i] === '}' || i >= text.length) { if (text[i] === ';') i++; if (prelude) nodes.push({ type: 'statement', text: prelude + ';' }); continue; }
      i++;
      if (GROUPS.test(prelude)) { nodes.push({ type: 'group', prelude, children: block() }); continue; }
      const open = i;
      for (let depth = 0; i < text.length; ) {
        const next = skip(text, i); if (next > i) { i = next; continue; }
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { if (!depth) break; depth--; }
        i++;
      }
      nodes.push({ type: 'rule', prelude, body: text.slice(open, i) });
      i++;
    }
    return nodes;
  };
  const url = at => { const end = text.indexOf(')', at); return end < 0 ? text.length - at : end + 1 - at; };
  const nodes = block();
  while (nodes.at(-1)?.type === 'blank') nodes.pop();
  return nodes;
}

export function format(nodes, depth = 0) {
  const pad = ' '.repeat(depth), lines = [];
  for (const node of nodes) {
    if (node.type === 'blank') { if (lines.length && lines.at(-1) !== '') lines.push(''); continue; }
    if (node.type === 'comment' || node.type === 'statement') lines.push(pad + (node.text ?? ''));
    else if (node.type === 'rule') lines.push(`${pad}${node.prelude}{${node.body.replace(/\s*\n\s*/g, ' ')}}`);
    else { lines.push(`${pad}${node.prelude}{`, ...format(node.children.filter(child => child.type !== 'blank'), depth + 1).split('\n').filter(Boolean), pad + '}'); }
  }
  while (lines.at(-1) === '') lines.pop();
  return lines.join('\n') + (depth ? '' : '\n');
}

export const formatCSS = text => format(parse(text));
export async function stylesheets() { return (await readdir(root)).filter(name => name.endsWith('.css')).sort(); }

// Chrome parses each sheet both ways; every rule's cssText must match, in order and nesting.
async function verify(pairs) {
  const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch({ channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true });
  const page = await browser.newPage();
  let failed = 0;
  for (const [name, before, after] of pairs) {
    const [a, b] = await page.evaluate(texts => texts.map(text => {
      const sheet = new CSSStyleSheet(); sheet.replaceSync(text);
      const list = rules => [...rules].flatMap(rule => rule.cssRules && !(rule instanceof CSSStyleRule) ? [rule.cssText.slice(0, rule.cssText.indexOf('{')), ...list(rule.cssRules)] : [rule.cssText]);
      return list(sheet.cssRules);
    }), [before, after]);
    const same = a.length === b.length && a.every((text, n) => text === b[n]);
    if (!same) { failed++; const n = a.findIndex((text, k) => text !== b[k]); console.log(`${name}: rule ${n} differs\n  ${a[n]}\n  ${b[n]}`); }
    else console.log(`${name}: ${a.length} rules identical`);
  }
  await browser.close();
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2], pairs = [];
  for (const name of await stylesheets()) { const text = await readFile(join(root, name), 'utf8'); pairs.push([name, text, formatCSS(text)]); }
  if (mode === '--verify') await verify(pairs);
  else if (mode === '--check') { const changed = pairs.filter(([, a, b]) => a !== b).map(([name]) => name); if (changed.length) { console.log('Not formatted: ' + changed.join(', ')); process.exitCode = 1; } }
  else for (const [name, before, after] of pairs) if (before !== after) { await writeFile(join(root, name), after); console.log('formatted ' + name); }
}
