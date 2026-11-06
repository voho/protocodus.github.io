/* DOM/UI regression check, independent of GPU speed. The scene boot is replaced
   with a presentation fixture; the actual menu shell, CSS, archive, controls,
   settings, mission copy and HUD run unchanged. Full-scene QA is separate.
   CHROMIUM_PATH selects a system browser. HEDGEROW_QA_OUTPUT saves screenshots. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = process.env.HEDGEROW_QA_OUTPUT ? resolve(process.env.HEDGEROW_QA_OUTPUT) : null;
if (output) await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    let path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Invalid path');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [];
let browser;
try {
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.endsWith('/js/main.js') || url.pathname === '/assets/js/analytics.js') {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    }
    return route.continue();
  });
  page.on('response', response => {
    if (response.url().startsWith(origin) && response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  await page.goto(origin + '/fun/hedgerow/?mission=saint-clair');
  await page.waitForSelector('[data-archive]:not([hidden])');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await document.querySelector('[data-archive-image]').decode();
    const { DEFAULT_SETTINGS } = await import('/fun/hedgerow/js/config.js');
    const { CONTROLS } = await import('/fun/hedgerow/js/controls.js');
    const { MISSIONS } = await import('/fun/hedgerow/js/missions.js');
    const { default: level } = await MISSIONS[0].load();
    document.querySelector('[data-menu]').hidden = false;
    for (const control of document.querySelectorAll('[data-setting]')) {
      const value = DEFAULT_SETTINGS[control.dataset.setting];
      if (control.type === 'checkbox') control.checked = !!value;
      else control.value = value;
    }
    for (const dl of document.querySelectorAll('[data-controls]')) {
      for (const [key, desc] of CONTROLS) {
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = key; dd.textContent = desc; dl.append(dt, dd);
      }
    }
    for (const text of level.briefing) {
      const p = document.createElement('p'); p.textContent = text; document.querySelector('[data-briefing-text]').append(p);
    }
    for (const [i, objective] of level.objectives.entries()) {
      const li = document.createElement('li'); li.textContent = objective.text;
      document.querySelector('[data-briefing-goals]').append(li);
      const pauseLi = li.cloneNode(true); pauseLi.dataset.state = i === 0 ? 'done' : i === 1 ? 'current' : 'waiting';
      document.querySelector('[data-pause-objectives]').append(pauseLi);
    }
    for (const [i, mission] of MISSIONS.entries()) {
      const li = document.createElement('li'), card = document.createElement('button'), img = document.createElement('img'), body = document.createElement('span');
      card.className = 'mission-card'; card.type = 'button'; card.dataset.mission = mission.id;
      if (!i) card.setAttribute('aria-current', 'true');
      img.src = mission.image; img.alt = mission.title; body.className = 'mc-body';
      for (const [cls, value] of [['mc-n', `Mission ${i + 1}`], ['mc-title', mission.title], ['mc-when', `${mission.place} · ${mission.time}`], ['mc-sum', mission.summary]]) {
        const span = document.createElement('span'); span.className = cls; span.textContent = value; body.append(span);
      }
      card.append(img, body); li.append(card); document.querySelector('[data-mission-list]').append(li);
    }
    await Promise.all([...document.images].map(img => img.decode()));
  });
  const show = async name => {
    await page.evaluate(name => {
      for (const screen of document.querySelectorAll('[data-screen]')) screen.classList.toggle('on', screen.dataset.screen === name);
    }, name);
    await page.waitForFunction(name => document.querySelector(`[data-screen="${name}"]`).getAttribute('aria-hidden') === 'false', name);
  };

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['start', 'missions', 'briefing', 'controls', 'settings', 'pause']) {
      await show(name);
      const layout = await page.evaluate(name => {
        const screen = document.querySelector(`[data-screen="${name}"]`);
        const panel = screen.querySelector('.panel');
        return { width: screen.clientWidth, contentWidth: screen.scrollWidth, top: panel.getBoundingClientRect().top, hiddenScreens: [...document.querySelectorAll('[data-screen]')].filter(s => s !== screen).every(s => s.inert) };
      }, name);
      assert.ok(layout.contentWidth <= layout.width + 1, `${name} overflows horizontally at ${width}px`);
      assert.ok(layout.top >= 0, `${name} top is unreachable at ${width}px`);
      assert.ok(layout.hiddenScreens, 'Inactive dialogs must be inert');
      if (output && (width === 1440 || width === 390)) await page.screenshot({ path: resolve(output, `ui-${name}-${width}.png`) });
    }
  }

  await show('settings');
  await page.locator('[data-screen="settings"] [data-action="back"]').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.setting), 'sensitivity', 'Tab wraps to the first active setting');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'back', 'Shift+Tab wraps to the last active control');
  await page.locator('[data-setting="effectsVolume"]').evaluate(el => { el.value = '0.35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.locator('[data-setting-value="effectsVolume"]').textContent(), '35%');
  assert.equal(await page.locator('[data-setting="effectsVolume"]').getAttribute('aria-valuetext'), '35%');
  await page.locator('[data-setting="difficulty"]').selectOption('veteran');
  assert.match(await page.locator('[data-difficulty-note]').textContent(), /Accurate enemy fire/);

  await show('start');
  const archive = await page.locator('[data-archive-image]').evaluate(img => ({ width: img.naturalWidth, alt: img.alt, src: img.getAttribute('src') }));
  assert.equal(archive.width, 1600, 'Historical image decodes locally');
  assert.match(archive.src, /^assets\/archive\//);
  assert.ok(archive.alt.length > 30, 'Archive photo has a descriptive alternative');
  assert.match(await page.locator('[data-archive-credit]').textContent(), /Public domain/);
  assert.equal(await page.locator('.loading-fill').evaluate(el => getComputedStyle(el).transitionDuration), '1e-05s', 'Reduced motion suppresses progress transitions');

  await page.evaluate(async () => {
    const { createHud } = await import('/fun/hedgerow/js/hud.js');
    const hud = createHud(document.querySelector('[data-hud]'));
    hud.health(.42);
  });
  assert.equal(await page.locator('[role="meter"]').getAttribute('aria-valuenow'), '42');
  assert.deepEqual(errors, [], 'UI has no script errors or failed local requests');
  console.log('ui-browser-check: six dialogs at four widths, local archive, keyboard focus, settings values, reduced motion and health semantics passed');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
