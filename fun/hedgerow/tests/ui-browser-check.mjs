/* DOM/UI regression check, independent of GPU speed. The scene boot is replaced
   with a presentation fixture; the actual accessibility module, CSS, archive, controls,
   settings, mission copy and HUD run unchanged. Full-scene QA is separate.
   CHROMIUM_PATH selects a system browser. HEDGEROW_QA_OUTPUT saves screenshots. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__webglRequests = [];
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/webgl/.test(type)) { window.__webglRequests.push(type); throw new Error('WebGL forbidden in DOM-only UI check'); }
      return get.call(this, type, ...args);
    };
  });
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
  assert.deepEqual(await page.locator('script[src]').evaluateAll(es => es.filter(e => /ui-accessibility|menu-shell/.test(e.src)).map(e => e.src.split('/').at(-1))), ['ui-accessibility.js'], 'Exactly one module owns focus');
  assert.equal(await page.locator('[data-archive-image]').getAttribute('src'), null, 'Closed historical reference does not download its pixels');
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.querySelector('[data-loading]').hidden = true;
    document.querySelector('[data-loading-briefing]').hidden = true;
    document.querySelector('[data-fade]').classList.remove('on');
    const begin = document.querySelector('[data-action="start"]'); begin.disabled = false; begin.textContent = 'Begin mission';
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
    await Promise.all([...document.images].filter(img => img.hasAttribute('src')).map(img => img.decode()));
  });
  const missionCards = await page.locator('[data-mission-list] [data-mission]').evaluateAll(cards => cards.map(card => {
    const img = card.querySelector('img');
    return { id: card.dataset.mission, image: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight };
  }));
  assert.deepEqual(missionCards.map(card => card.id), ['saint-clair', 'la-varenne', 'pont-tournant'], 'The selector has exactly three Normandy missions');
  for (const card of missionCards) {
    assert.equal(card.image, `assets/missions/${card.id}.webp`, 'Each mission uses its own local loading image');
    assert.ok(card.width > 0 && card.height > 0, 'Every mission-card image decodes');
  }
  const show = async name => {
    await page.evaluate(name => {
      for (const screen of document.querySelectorAll('[data-screen]')) {
        screen.classList.toggle('on', screen.dataset.screen === name);
        if (screen.dataset.screen === name) screen.scrollTop = 0;
      }
    }, name);
    await page.waitForFunction(name => document.querySelector(`[data-screen="${name}"]`).getAttribute('aria-hidden') === 'false', name);
  };

  const layouts = [];
  for (const {width, height} of [{width:768,height:1024}, {width:1024,height:768}, {width:960,height:600}, {width:1440,height:900}]) {
    await page.setViewportSize({ width, height });
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
      layouts.push({ name, width, height, ...layout });
      if (name === 'briefing') {
        for (const y of [0, 99999]) {
          await page.locator('[data-screen="briefing"]').evaluate((el,y) => {el.scrollTop=y}, y);
          const rect = await page.locator('[data-action="start"]').boundingBox();
          assert.ok(rect.y >= 0 && rect.y + rect.height <= height, `Begin mission stays visible at ${width}×${height}`);
        }
      }
      if (output) await page.screenshot({ path: resolve(output, `ui-${name}-${width}x${height}.png`) });
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

  await page.locator('[data-setting="effectsVolume"]').focus();
  await show('controls'); await show('settings');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.setting), 'effectsVolume', 'Settings restores the previously focused control');
  await page.locator('[data-setting="ambienceVolume"]').evaluate(el => { el.value = '0.65'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.locator('[data-setting-value="ambienceVolume"]').textContent(), '65%');
  assert.ok(await page.locator('[data-setting="motionBlur"]').count()); assert.ok(await page.locator('[data-setting="cameraShake"]').count());

  await show('briefing');
  const mapDetails = page.locator('[data-screen="briefing"] [data-field-map]');
  await mapDetails.evaluate(async el => {
    const { default:L } = await import('/fun/hedgerow/js/levels/saint-clair.js');
    const { buildFieldMapData, renderFieldMap } = await import('/fun/hedgerow/js/field-map.js');
    renderFieldMap(el.querySelector('[data-field-map-body]'), await buildFieldMapData(L), {
      title:L.title, mission: {isComplete:id => id===L.objectives[0].id, isActive:id => id===L.objectives[1].id}
    });
    el.open=true;
  });
  for (const {width,height} of [{width:768,height:1024}, {width:1024,height:768}, {width:960,height:600}]) {
    await page.setViewportSize({width,height});
    for (const y of [0,500,99999]) {
      await page.locator('[data-screen="briefing"]').evaluate((el,y) => {el.scrollTop=y}, y);
      const rect=await page.locator('[data-action="start"]').boundingBox();
      assert.ok(rect.y>=0 && rect.y+rect.height<=height, 'Sticky action remains visible with field map open');
    }
    assert.ok(await page.locator('[data-screen="briefing"]').evaluate(el=>el.scrollWidth<=innerWidth));
    if (output) await page.screenshot({path:resolve(output,`ui-map-open-${width}x${height}.png`)});
  }
  assert.equal(await page.locator('.field-map-orders [aria-current="step"]').count(), 1);

  await show('start');
  await page.locator('[data-archive]').evaluate(el => {el.open=true});
  await page.waitForFunction(() => document.querySelector('[data-archive-image]').naturalWidth>0);
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
  await show('unsupported');
  assert.equal(await page.locator('[data-screen="unsupported"] h2').textContent(), 'Use a tablet or PC');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'retry');
  assert.deepEqual(await page.evaluate(() => window.__webglRequests), [], 'DOM fixture never creates WebGL');
  await page.evaluate(() => localStorage.setItem('hedgerow.mission', 'prague'));
  await page.goto(origin + '/fun/hedgerow/?mission=prague');
  await page.waitForFunction(() => document.querySelector('[data-screen="start"]').getAttribute('aria-hidden') === 'false');
  assert.equal(await page.locator('[data-archive]').isHidden(), false, 'A removed mission in the URL and storage falls back to the Normandy archive');
  assert.match(await page.locator('[data-archive-caption]').textContent(), /2nd Infantry Division/);
  assert.equal(await page.locator('[data-archive-image]').getAttribute('src'), null, 'The fallback archive remains lazy');
  await page.evaluate(() => localStorage.setItem('hedgerow.mission', 'la-varenne'));
  await page.goto(origin + '/fun/hedgerow/?mission=prague');
  await page.waitForSelector('[data-archive]:not([hidden])');
  assert.match(await page.locator('[data-archive-caption]').textContent(), /Eisenhower/, 'A valid stored Normandy mission wins over a removed URL mission');
  assert.equal(await page.locator('[data-archive-image]').getAttribute('src'), null);
  assert.deepEqual(errors, [], 'UI has no script errors or failed local requests');
  if (output) {
    const hashes={};
    for (const path of ['index.html','hedgerow.css','js/ui-accessibility.js','js/archive.js','js/hud.js','js/controls.js']) hashes[path]=createHash('sha256').update(await readFile(resolve(root,'fun/hedgerow',path))).digest('hex');
    await writeFile(resolve(output,'report.json'),JSON.stringify({layouts,missionCards,hashes,errors,webglRequests:0},null,2));
  }
  console.log('ui-browser-check: three local Normandy cards, removed-mission fallback, supported tablet/PC dialogs, sticky orders/maps, sole focus trap/restoration, lazy local archive, audio values/ARIA, difficulty, reduced motion and health passed without WebGL');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
