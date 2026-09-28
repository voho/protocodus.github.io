// The UI floor (DESIGN.md 14 and 17) over every harness state at desk, phone and narrow widths: no page errors, no
// sideways scroll, text of 12 px or more, AA contrast on opaque surfaces, a visible ring on every Tab stop and 44 px
// buttons on phones. Violations are keyed 'viewport|state|rule|selector'; the check fails only on keys missing from
// tests/ui-baseline/<surface>.json. UI_BASELINE_WRITE=1 records today's violations as the new ceiling.
// Serve the repository root first (TRANSPORT_URL); TRANSPORT_OUTPUT receives report.json.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { VIEWPORTS, LAUNCH } from '../tools/ui-snapshot.mjs';
import { states } from './ui-states/index.mjs';
import { prepare } from './ui-states/setup.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-ui-system';
const only = process.env.UI_STATES ? new RegExp(process.env.UI_STATES) : null;
const baselineDir = new URL('./ui-baseline/', import.meta.url);
await mkdir(output, { recursive: true });

// Runs in the page: every violation of the static rules, as [rule, selector, detail].
function audit(phone) {
  const found = [], seen = new Set();
  const name = el => {
    const own = el.id ? `${el.localName}#${el.id}` : el.localName + [...el.classList].slice(0, 3).map(c => '.' + c).join('');
    if (el.id) return own;
    const anchor = el.parentElement?.closest('[id]');
    return anchor && anchor !== document.body ? `#${anchor.id} ${own}` : own;
  };
  const add = (rule, el, detail) => { const key = rule + '|' + name(el); if (!seen.has(key)) { seen.add(key); found.push([rule, name(el), detail]); } };
  // The topmost modal dialog is the one under the centre of the screen; everything else is inert.
  const centre = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('dialog'), modals = [...document.querySelectorAll('dialog')].filter(d => d.matches(':modal'));
  const modal = centre?.matches(':modal') ? centre : modals.at(-1);
  const live = el => (!modal || modal.contains(el)) && !el.closest('[inert]');
  const shown = el => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    for (let a = el; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.clip === 'rect(0px, 0px, 0px, 0px)' || (s.overflow === 'hidden' && a !== el && a.getBoundingClientRect().width <= 1)) return false; }
    return true;
  };
  const rgba = text => { const m = text.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const SCENE = new Set(['BODY', 'HTML', 'MAIN']);
  // The surface under an element: its own and its ancestors' backgrounds down to the first opaque one; null over the map or art.
  const surface = el => {
    const layers = [];
    for (let a = el; a; a = a.parentElement) {
      if (SCENE.has(a.tagName) || a.id === 'app' || a.classList.contains('map-section') || a.classList.contains('workspace')) return null;
      const s = getComputedStyle(a);
      if (s.backgroundImage !== 'none' || parseFloat(s.opacity) < 1) return null;
      const bg = rgba(s.backgroundColor);
      if (bg && bg.a >= .99) { let c = bg; for (const layer of layers.reverse()) c = over(layer, c); return c; }
      if (bg && bg.a > 0) layers.push(bg);
    }
    return null;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!node.textContent.trim() || !el || el.closest('svg, canvas, script, style, noscript') || !live(el) || !shown(el)) continue;
    const s = getComputedStyle(el), size = parseFloat(s.fontSize);
    if (size < 12) add('type-floor', el, `${size}px`);
    // Inactive controls and logotypes are exempt from contrast (WCAG 1.4.3).
    if (el.closest(':disabled, [aria-disabled="true"], .brand-symbol, .start-wordmark, .loading-brand')) continue;
    const base = surface(el), color = rgba(s.color);
    if (!base || !color) continue;
    const fg = color.a < 1 ? over(color, base) : color, hi = Math.max(lum(fg), lum(base)), lo = Math.min(lum(fg), lum(base)), ratio = (hi + .05) / (lo + .05);
    const large = size >= 24 || (size >= 18.66 && parseInt(s.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) add('contrast', el, ratio.toFixed(2));
  }
  if (phone) for (const el of document.querySelectorAll('button, [role="button"]')) {
    if (!live(el) || !shown(el) || el.closest('.ref--prose')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) add('target', el, `${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { found, overflow: document.documentElement.scrollWidth > innerWidth ? document.documentElement.scrollWidth : 0 };
}

// Where Tab lands, and whether the stop shows an outline or a ring.
function focusRing() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const s = getComputedStyle(el), id = el.id ? `${el.localName}#${el.id}` : el.localName + [...el.classList].slice(0, 3).map(c => '.' + c).join('');
  const anchor = !el.id && el.parentElement?.closest('[id]'), key = anchor && anchor !== document.body ? `#${anchor.id} ${id}` : id;
  const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && !/rgba\([^)]*,\s*0\)|transparent/.test(s.outlineColor);
  return { key, ok: outline || s.boxShadow !== 'none' };
}

const viewports = ['desk', 'phone', 'narrow'], jobs = [];
for (const viewport of viewports) for (const state of states) if (!only || only.test(state.name)) jobs.push({ viewport, state });
const browser = await chromium.launch(LAUNCH), violations = new Map(), failures = [];
let next = 0;
await Promise.all(Array.from({ length: Number(process.env.UI_JOBS || 4) }, async () => {
  while (next < jobs.length) {
    const { viewport, state } = jobs[next++], context = await browser.newContext(VIEWPORTS[viewport]), page = await context.newPage(), errors = [];
    const add = (rule, selector, detail) => violations.set(`${viewport}|${state.name}|${rule}|${selector}`, { surface: state.surface, detail });
    page.on('pageerror', error => errors.push(error.message));
    try {
      await prepare(page);
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('#start-menu')?.open);
      await state.setup(page);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const { found, overflow } = await page.evaluate(audit, VIEWPORTS[viewport].viewport.width <= 700);
      for (const [rule, selector, detail] of found) add(rule, selector, detail);
      if (overflow) add('overflow', 'html', `${overflow}px`);
      for (let step = 0; step < 40; step++) {
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(focusRing);
        if (ring && !ring.ok) add('focus', ring.key, 'no outline or ring');
      }
      for (const error of errors) add('page-error', error.slice(0, 80), error);
    } catch (error) { failures.push(`${viewport}/${state.name}: ${error.message.split('\n')[0]}`); }
    await context.close();
  }
}));
await browser.close();

const bySurface = {};
for (const [key, { surface }] of violations) (bySurface[surface] ||= []).push(key);
await writeFile(`${output}/report.json`, JSON.stringify(Object.fromEntries([...violations].sort()), null, 1));
if (process.env.UI_BASELINE_WRITE) {
  await mkdir(baselineDir, { recursive: true });
  for (const surface of new Set(states.map(state => state.surface))) {
    const file = new URL(`${surface}.json`, baselineDir), kept = existsSync(file) && only ? JSON.parse(await readFile(file, 'utf8')) : [];
    await writeFile(file, JSON.stringify([...new Set([...kept, ...(bySurface[surface] || [])])].sort(), null, 1) + '\n');
  }
}
const fresh = [];
for (const [surface, keys] of Object.entries(bySurface)) {
  const file = new URL(`${surface}.json`, baselineDir), allowed = new Set(existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : []);
  for (const key of keys) if (!allowed.has(key)) fresh.push(`${key}  (${violations.get(key).detail})`);
}
console.log(`${jobs.length} captures, ${violations.size} violations, ${fresh.length} not in the baseline`);
if (failures.length) console.error('States that failed to set up:\n' + failures.join('\n'));
if (fresh.length) console.error('New violations:\n' + fresh.sort().join('\n'));
if (failures.length || fresh.length) process.exitCode = 1;
