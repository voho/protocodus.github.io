// tools/ui-specimen.html at desk 1440 and phone 390: it loads without errors, shows every class DESIGN.md 16.3 gives
// components.css, passes the UI floor of ui-system-browser-check (the same tests/ui-audit.mjs rules, over the whole page),
// shows a visible ring at every Tab stop, and its forced hover and focus samples really differ from rest. Full-page
// screenshots land in TRANSPORT_OUTPUT. Serve the repository root first (TRANSPORT_URL).
import { mkdir } from 'node:fs/promises';
import { VIEWPORTS, LAUNCH } from '../tools/ui-snapshot.mjs';
import { audit, focusRing } from './ui-audit.mjs';

const { chromium } = await import(process.env.TRANSPORT_PLAYWRIGHT || 'playwright');
const url = new URL('tools/ui-specimen.html', process.env.TRANSPORT_URL || 'http://127.0.0.1:8765/fun/transport/').href;
const output = process.env.TRANSPORT_OUTPUT || '/tmp/transport-ui-specimen';
await mkdir(output, { recursive: true });

// Runs in the page: computed values that tell a forced state from rest.
function forced() {
  const style = (selector, prop) => { const el = document.querySelector(selector); return el ? getComputedStyle(el)[prop] : 'missing'; };
  return {
    secondary: [style('#buttons .button--secondary:not(.is-hover):not(:disabled)', 'backgroundColor'), style('#buttons .button--secondary.is-hover', 'backgroundColor')],
    primary: [style('#buttons .button--primary:not(.is-hover):not(:disabled)', 'backgroundColor'), style('#buttons .button--primary.is-hover', 'backgroundColor')],
    row: [style('#rows .row:not(.is-hover):not(.row--expanded):not(.is-focus)', 'backgroundColor'), style('#rows .row.is-hover', 'backgroundColor')],
    switch: [style('#switch .switch:not(:checked):not(.is-hover)', 'backgroundColor'), style('#switch .switch.is-hover:not(:checked)', 'backgroundColor')],
    focus: [style('#buttons .button--secondary:not(.is-focus)', 'outlineStyle'), style('#buttons .button--secondary.is-focus', 'outlineStyle')],
    pendingWidth: [...document.querySelectorAll('#buttons .button--primary:not(.button--dense)')].filter(el => !el.closest('.on-ink')).map(el => Math.round(el.getBoundingClientRect().width)),
  };
}

const browser = await chromium.launch(LAUNCH), failures = [];
for (const viewport of ['desk', 'phone']) {
  const { width } = VIEWPORTS[viewport].viewport, context = await browser.newContext(VIEWPORTS[viewport]), page = await context.newPage(), errors = [];
  const fail = message => failures.push(`${viewport}: ${message}`);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 15000 });
  const missing = await page.evaluate(() => document.body.dataset.missing);
  if (missing === undefined) fail('the class contract was not read');
  else if (missing) fail(`contract classes missing from the page: ${missing}`);

  // The audit reads only what is on screen, so the viewport first grows to the whole page.
  await page.setViewportSize({ width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
  const { found, overflow } = await page.evaluate(audit, width <= 700);
  for (const [rule, selector, detail] of found) fail(`${rule} ${selector} (${detail})`);
  if (overflow) fail(`the page scrolls sideways to ${overflow}px`);

  const states = await page.evaluate(forced);
  for (const key of ['secondary', 'primary', 'row', 'switch']) if (states[key][0] === states[key][1] || states[key].includes('missing')) fail(`forced hover does not change ${key}: ${states[key].join(' / ')}`);
  if (states.focus[0] !== 'none' || states.focus[1] === 'none') fail(`forced focus shows no ring: ${states.focus.join(' / ')}`);
  if (new Set(states.pendingWidth).size !== 1) fail(`pending changes the button's width: ${states.pendingWidth.join(', ')}`);
  // In pieces of 4000 px: one capture of a tall page at 2x outgrows Chrome's capture surface and repeats its tiles.
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0, part = 1; y < pageHeight; y += 4000, part++) await page.screenshot({ path: `${output}/specimen-${viewport}-${part}.png`, fullPage: true, clip: { x: 0, y, width, height: Math.min(4000, pageHeight - y) }, animations: 'disabled', caret: 'hide' });

  // Tab once through every control; each stop must show an outline or a ring.
  await page.setViewportSize(VIEWPORTS[viewport].viewport);
  const stops = await page.evaluate(() => document.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary').length);
  const rings = new Map();
  for (let step = 0; step < stops + 2; step++) {
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(focusRing);
    if (ring) rings.set(ring.key, (rings.get(ring.key) ?? true) && ring.ok);
  }
  for (const [key, ok] of rings) if (!ok) fail(`no visible focus ring on ${key}`);
  if (rings.size < 20) fail(`the Tab walk reached only ${rings.size} kinds of control`);
  for (const error of errors) fail(`page error: ${error}`);
  console.log(`${viewport}: ${stops} controls, ${rings.size} kinds of Tab stop, ${found.length} audit findings`);
  await context.close();
}
await browser.close();
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`ui specimen ok; screenshots in ${output}`);
