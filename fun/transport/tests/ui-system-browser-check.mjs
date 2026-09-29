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
import { audit, focusRing } from './ui-audit.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const url = process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/';
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-ui-system';
const only = process.env.UI_STATES ? new RegExp(process.env.UI_STATES) : null;
const baselineDir = new URL('./ui-baseline/', import.meta.url);
await mkdir(output, { recursive: true });

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
