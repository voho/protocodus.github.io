#!/usr/bin/env node
// Screenshots and computed styles of every UI harness state (tests/ui-states) at four viewports.
//   node fun/transport/tools/ui-snapshot.mjs --out DIR [--viewports desk,compact,phone,narrow,landscape] [--only REGEX] [--jobs 3] [--no-png]
//   node fun/transport/tools/ui-snapshot.mjs --diff A B
// Capturing needs the game served (TRANSPORT_URL) and Playwright (TRANSPORT_PLAYWRIGHT). Every capture runs with
// reduced motion, after fonts have loaded, on a fresh page. --diff exits non-zero when any element or property differs.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const VIEWPORTS = {
  desk: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  compact: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  narrow: { viewport: { width: 320, height: 640 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
export const DEFAULT_VIEWPORTS = ['desk', 'compact', 'phone', 'narrow'];
export const LAUNCH = { channel: process.env.TRANSPORT_BROWSER || 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] };

const args = process.argv.slice(2), option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };

// Runs in the page: a stable path and the computed style of every element under body. Values equal to the
// browser default for the tag (read in a style-free frame) are left out, so a diff still sees every change.
function collect() {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  document.documentElement.append(frame);
  const blank = frame.contentDocument, defaults = new Map();
  const base = tag => {
    if (defaults.has(tag)) return defaults.get(tag);
    const el = blank.createElement(tag); blank.body.append(el);
    const style = frame.contentWindow.getComputedStyle(el), map = {};
    for (let i = 0; i < style.length; i++) map[style[i]] = style.getPropertyValue(style[i]);
    el.remove(); defaults.set(tag, map); return map;
  };
  const part = el => {
    const tag = el.localName;
    if (el.id) return `${tag}#${el.id}`;
    let n = 1; for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.localName === tag) n++;
    return tag + [...el.classList].map(name => '.' + name).join('') + `:nth-of-type(${n})`;
  };
  const read = (style, fallback) => {
    const out = {};
    for (let i = 0; i < style.length; i++) { const prop = style[i], value = style.getPropertyValue(prop); if (fallback[prop] !== value) out[prop] = value; }
    return out;
  };
  const elements = {}, skip = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript']);
  const walk = (el, path) => {
    for (const child of el.children) {
      if (skip.has(child.localName)) continue;
      const here = `${path}>${part(child)}`, fallback = base(child.localName);
      elements[here] = read(getComputedStyle(child), fallback);
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(child, pseudo), content = style.getPropertyValue('content');
        if (content && content !== 'none' && content !== 'normal') elements[here + pseudo] = read(style, {});
      }
      if (child.localName !== 'canvas' && child.localName !== 'svg') walk(child, here);
      else if (child.localName === 'svg') for (const shape of child.querySelectorAll('*')) elements[`${here}>${part(shape)}`] = read(getComputedStyle(shape), base(shape.localName));
    }
  };
  walk(document.body, 'body');
  frame.remove();
  return { url: location.href, viewport: { width: innerWidth, height: innerHeight }, elements };
}

async function capture() {
  const out = option('--out'); if (!out) throw new Error('--out DIR is required');
  const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
  const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
  const { states } = await import('../tests/ui-states/index.mjs'), { prepare } = await import('../tests/ui-states/setup.mjs');
  const only = option('--only') ? new RegExp(option('--only')) : null, png = !args.includes('--no-png');
  const viewports = option('--viewports')?.split(',') || DEFAULT_VIEWPORTS;
  const jobs = [];
  for (const viewport of viewports) for (const state of states) if (!only || only.test(state.name)) jobs.push({ viewport, state });
  const browser = await chromium.launch(LAUNCH), failures = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { viewport, state } = jobs[next++], started = Date.now();
      const context = await browser.newContext(VIEWPORTS[viewport]), page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await prepare(page);
        await page.goto(url);
        await page.waitForFunction(() => document.querySelector('#start-menu')?.open);
        await state.setup(page);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const dir = join(out, viewport); await mkdir(dir, { recursive: true });
        await writeFile(join(dir, state.name + '.json'), JSON.stringify(await page.evaluate(collect)));
        if (png) await page.screenshot({ path: join(dir, state.name + '.png'), animations: 'disabled', caret: 'hide' });
        if (errors.length) failures.push(`${viewport}/${state.name}: page errors ${errors.join(' | ')}`);
        console.log(`${viewport}/${state.name} ${((Date.now() - started) / 1000).toFixed(1)}s`);
      } catch (error) { failures.push(`${viewport}/${state.name}: ${error.message.split('\n')[0]}`); console.log(`${viewport}/${state.name} FAILED ${error.message.split('\n')[0]}`); }
      await context.close();
    }
  };
  await Promise.all(Array.from({ length: Number(option('--jobs', 3)) }, worker));
  await browser.close();
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
}

async function states(dir) {
  const found = new Map();
  if (!existsSync(dir)) return found;
  for (const viewport of await readdir(dir, { withFileTypes: true })) if (viewport.isDirectory())
    for (const file of await readdir(join(dir, viewport.name))) if (file.endsWith('.json')) found.set(`${viewport.name}/${file.slice(0, -5)}`, join(dir, viewport.name, file));
  return found;
}

async function diff(a, b) {
  const left = await states(a), right = await states(b), lines = [];
  let changed = 0;
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    if (!left.has(key) || !right.has(key)) { lines.push(`${key}: only in ${left.has(key) ? a : b}`); changed++; continue; }
    const A = JSON.parse(await readFile(left.get(key), 'utf8')).elements, B = JSON.parse(await readFile(right.get(key), 'utf8')).elements;
    for (const path of new Set([...Object.keys(A), ...Object.keys(B)])) {
      if (!A[path] || !B[path]) { lines.push(`${key} ${path}: only in ${A[path] ? a : b}`); changed++; continue; }
      const props = [...new Set([...Object.keys(A[path]), ...Object.keys(B[path])])].filter(prop => A[path][prop] !== B[path][prop]);
      if (!props.length) continue;
      changed++;
      lines.push(`${key} ${path}\n${props.map(prop => `    ${prop}: ${A[path][prop] ?? '(default)'} -> ${B[path][prop] ?? '(default)'}`).join('\n')}`);
    }
  }
  console.log(lines.length ? lines.join('\n') : `No differences across ${left.size} captures.`);
  if (changed) { console.log(`${changed} changed element(s)`); process.exitCode = 1; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (args[0] === '--diff') await diff(args[1], args[2]);
  else await capture();
}
