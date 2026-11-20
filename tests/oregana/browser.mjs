// Run with node tests/oregana/browser.mjs. Set CHROMIUM_PATH to use system Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const simdPath = '/fun/oregana/dsp/organ-simd.wasm';
const javascriptPath = '/fun/oregana/dsp/core.mjs';
// AudioWorklet module fetches may bypass the page's request observer. Record
// successful responses at the static server instead, per fresh browser context.
const servedPaths = new Set();
const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    const path = resolve(root, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!path.startsWith(resolve(root) + sep)) throw new Error('Invalid path');
    const body = await readFile(path);
    servedPaths.add(pathname);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

// Observe real worklet messages and samples. Only the MIDI hardware is simulated.
function observeInstrument(hasMidi) {
  const qa = window.organQA = { messages: [], peaks: [0, 0], stereoDifference: 0 };
  const WorkletNode = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends WorkletNode {
    constructor(context, ...args) {
      super(context, ...args);
      const send = this.port.postMessage.bind(this.port);
      this.port.postMessage = (message, ...extra) => {
        qa.messages.push(message);
        return send(message, ...extra);
      };
      const splitter = context.createChannelSplitter(2);
      this.connect(splitter);
      const meters = [0, 1].map(channel => {
        const meter = context.createAnalyser();
        meter.fftSize = 2048;
        splitter.connect(meter, channel);
        return meter;
      });
      const samples = meters.map(meter => new Float32Array(meter.fftSize));
      const timer = setInterval(() => {
        if (context.state === 'closed') return clearInterval(timer);
        meters.forEach((meter, i) => meter.getFloatTimeDomainData(samples[i]));
        const [left, right] = samples;
        for (let i = 0; i < left.length; ++i) {
          qa.peaks[0] = Math.max(qa.peaks[0], Math.abs(left[i]));
          qa.peaks[1] = Math.max(qa.peaks[1], Math.abs(right[i]));
          qa.stereoDifference = Math.max(qa.stereoDifference, Math.abs(left[i] - right[i]));
        }
      }, 20);
    }
  };

  const port = { id: 'organ-qa', name: 'Organ QA Keyboard', type: 'input', state: 'connected', close: async () => {} };
  const access = { inputs: new Map([[port.id, port]]) };
  qa.midi = (...data) => {
    if (port.state === 'connected') port.onmidimessage?.({ data: new Uint8Array(data), target: port });
  };
  qa.connect = state => {
    port.state = state;
    access.onstatechange?.({ port });
  };
  Object.defineProperty(navigator, 'requestMIDIAccess', { value: hasMidi ? async () => access : undefined });
}

const errors = [];
async function load(context, hasMidi) {
  servedPaths.clear();
  await context.addInitScript(observeInstrument, hasMidi);
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    return route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(origin + '/fun/oregana/') && response.status() >= 400) {
      errors.push(response.status() + ' ' + response.url());
    }
  });
  await page.goto(origin + '/fun/oregana/');
  await key(page, 60).waitFor();
  return page;
}

function key(page, note, division = 0) {
  return page.locator(`#keyboard [data-division="${division}"] [data-note="${note}"]`);
}
async function point(page, note, division = 0) {
  const button = key(page, note, division);
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  assert.ok(box);
  // Hit the exposed front of a natural key, below its black neighbours.
  return [box.x + box.width / 2, box.y + box.height * 0.83];
}
const pressed = (page, note, division = 0) => key(page, note, division).getAttribute('aria-pressed');
const messages = page => page.evaluate(() => window.organQA.messages);
const midi = (page, ...data) => page.evaluate(data => window.organQA.midi(...data), data);

function waitForStereo(page) {
  return page.waitForFunction(() => window.organQA.peaks.every(peak => peak > 0.003) && window.organQA.stereoDifference > 0.0001);
}

async function assertLayout(page, fitHeight) {
  const issues = await page.evaluate(async fitHeight => {
    const { controls, presets, divisions } = await import('/fun/oregana/metadata.js');
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('Horizontal overflow');
    if (document.querySelector('select, details:not([open])')) issues.push('A choice is hidden behind a dropdown or disclosure');
    if (controls.length !== 98 || controls.filter(c => c.ranks).length !== 51 || presets.length !== 77) {
      issues.push('Incomplete control or preset bank');
    }
    function check(selector, expectedName) {
      const node = document.querySelector(selector);
      if (!node || !node.checkVisibility()) {
        issues.push(selector + ' missing or hidden');
        return;
      }
      if (expectedName && ![node.textContent.trim(), node.getAttribute('aria-label')].includes(expectedName)) {
        issues.push(selector + ' has lost its name: ' + expectedName);
      }
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.left < -1 || r.right > innerWidth + 1) issues.push(selector + ' outside console width');
      if (fitHeight && (r.top < -1 || r.bottom > innerHeight + 1)) issues.push(selector + ' outside viewport, bottom ' + Math.ceil(r.bottom));
      if (fitHeight && node.matches('button, input') && r.bottom <= innerHeight) {
        // Natural keys must be struck below their overlapping sharps.
        const y = r.top + r.height * (node.hasAttribute('data-note') ? 0.83 : 0.5);
        const target = document.elementFromPoint(r.left + r.width / 2, y);
        if (!node.contains(target)) issues.push(selector + ' is covered by ' + (target?.id || target?.className));
      }
      // Detect internally scrolling/clipped panels even when their own box fits.
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if ((css.overflowY !== 'visible' && (r.top < bounds.top - 2 || r.bottom > bounds.bottom + 2)) ||
            (css.overflowX !== 'visible' && (r.left < bounds.left - 2 || r.right > bounds.right + 2))) {
          issues.push(selector + ' clipped by ' + (parent.id || parent.className || parent.tagName));
          break;
        }
      }
    }
    for (const control of controls) {
      check('#control-' + control.id);
      if (control.ranks) check('#draw-' + control.id);
      control.options?.forEach((_, i) => check('#control-' + control.id + '-' + i));
    }
    presets.forEach((preset, i) => check('button#preset-' + i, preset.name));
    divisions.forEach((division, index) => {
      const selector = '#keyboard [data-division="' + index + '"]';
      check(selector);
      const bed = document.querySelector(selector);
      if (!bed?.getAttribute('aria-label')?.includes(division)) issues.push(division + ' keybed not named');
      const keys = document.querySelectorAll(selector + ' button[data-note]');
      if (!keys.length) issues.push(division + ' keybed empty');
      for (const key of keys) check(selector + ' button[data-note="' + key.dataset.note + '"]');
    });
    return issues;
  }, fitHeight);
  const size = page.viewportSize();
  assert.deepEqual(issues, [], `Console at ${size.width}×${size.height}: ${issues.slice(0, 12).join(', ')}`);
}

async function desktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await load(context, true);
  await assertLayout(page, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await assertLayout(page, true);

  const c = await point(page, 60);
  await page.mouse.move(...c);
  await page.mouse.down();
  assert.equal(await pressed(page, 60), 'true');
  await waitForStereo(page);
  const peaks = await page.evaluate(() => window.organQA.peaks);
  assert.equal(await page.locator('#audio-status').getAttribute('data-renderer'), 'simd');
  assert.ok(servedPaths.has(simdPath), 'Real SIMD binary must reach the browser');
  assert.ok(!servedPaths.has(javascriptPath), 'The SIMD renderer must avoid downloading the JavaScript DSP');
  assert.equal(await page.locator('#audio-start').getAttribute('aria-pressed'), 'true');
  await page.mouse.move(...await point(page, 64), { steps: 5 });
  assert.equal(await pressed(page, 60), 'false');
  assert.equal(await pressed(page, 64), 'true');
  await page.mouse.up();
  assert.equal(await pressed(page, 64), 'false');

  // Start a fresh audio graph per division, so a previous note's church
  // reverberation cannot make a silent division appear to sound.
  for (const division of [1, 2, 3]) {
    await page.locator('#audio-start').click();
    await page.evaluate(() => { window.organQA.peaks = [0, 0]; window.organQA.stereoDifference = 0; });
    const [x, y] = await point(page, 48, division);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await waitForStereo(page);
    assert.equal(await page.locator('#audio-status').getAttribute('data-renderer'), 'simd');
    assert.equal(await pressed(page, 48, division), 'true');
    assert.equal(await pressed(page, 48), 'false');
    await page.mouse.up();
    assert.equal(await pressed(page, 48, division), 'false');
  }

  await page.locator('#midi-connect').click();
  assert.match(await page.locator('#midi-status').innerText(), /Organ QA Keyboard/);
  const before = (await messages(page)).length;
  await midi(page, 0x90, 60, 113);
  await page.keyboard.down('KeyQ');
  await page.mouse.move(...await point(page, 60));
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('KeyQ');
  assert.equal(await pressed(page, 60), 'true');
  await midi(page, 0x80, 60, 37);
  assert.equal(await pressed(page, 60), 'false');
  const sequence = (await messages(page)).slice(before).filter(m => m.note === 60);
  assert.deepEqual(sequence.map(m => [m.type, m.division, m.velocity]), [
    ['noteOn', undefined, 113], ['divisionNoteOn', 0, 64], ['divisionNoteOff', 0, 64], ['noteOff', undefined, 37]
  ]);

  await page.keyboard.down('KeyZ');
  await page.keyboard.down('KeyX');
  assert.equal(await pressed(page, 48), 'true');
  assert.equal(await pressed(page, 50), 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await pressed(page, 48), 'false');
  assert.equal(await pressed(page, 50), 'false');
  await page.keyboard.up('KeyZ');
  await page.keyboard.up('KeyX');
  await page.locator('#octave-up').click();
  await page.keyboard.down('KeyZ');
  assert.equal(await pressed(page, 60), 'true');
  await page.keyboard.up('KeyZ');

  await midi(page, 0xb0, 1, 85);
  await midi(page, 0xb0, 11, 42);
  await midi(page, 0xe0, 0, 96);
  const controls = await messages(page);
  assert.ok(controls.some(m => m.type === 'controllers' && m.wheel === 85 / 127 && m.expression === 42 / 127));
  assert.ok(controls.some(m => m.type === 'bend' && m.value === 0.5));
  await midi(page, 0x92, 60, 70);
  await midi(page, 0x92, 64, 76);
  await midi(page, 0xb2, 123, 0);
  assert.equal(await pressed(page, 60), 'false');
  assert.equal(await pressed(page, 64), 'false');
  await midi(page, 0x91, 65, 99);
  await page.evaluate(() => window.organQA.connect('disconnected'));
  assert.equal(await pressed(page, 65), 'false');
  assert.match(await page.locator('#midi-status').innerText(), /Waiting/);
  await page.evaluate(() => window.organQA.connect('connected'));
  await midi(page, 0x90, 62, 47);
  assert.equal(await pressed(page, 62), 'true');
  await midi(page, 0x90, 62, 0);
  assert.equal(await pressed(page, 62), 'false');
  await page.locator('#midi-connect').click();
  assert.match(await page.locator('#midi-status').innerText(), /Disconnected/);

  // Every factory registration is a direct button. Exercise all options before
  // verifying the selected registration is immediately playable by computer.
  for (let index = 0; index < 77; ++index) {
    const preset = page.locator('#preset-' + index);
    await preset.click();
    assert.equal(await preset.getAttribute('aria-pressed'), 'true');
  }
  const recalls = (await messages(page)).filter(event => event.type === 'preset').map(event => event.index);
  assert.deepEqual(recalls, Array.from({ length: 77 }, (_, i) => i));
  await page.getByRole('button', { name: 'Gedackt 8', exact: true }).click();
  await page.keyboard.down('KeyQ');
  assert.equal(await pressed(page, 72), 'true');
  await page.keyboard.up('KeyQ');

  const manual = page.locator('#control-keyboard-1');
  await manual.focus();
  await page.keyboard.press('Space');
  assert.equal(await manual.getAttribute('aria-pressed'), 'true');
  await page.keyboard.down('KeyZ');
  assert.equal(await pressed(page, 60, 1), 'true');
  assert.equal(await pressed(page, 60), 'false');
  await page.keyboard.up('KeyZ');
  const stop = page.locator('#control-hw_octave_8');
  assert.equal(await stop.getAttribute('aria-pressed'), 'false');
  await stop.click();
  assert.equal(await stop.getAttribute('aria-pressed'), 'true');
  assert.ok((await messages(page)).some(m => m.type === 'control' && m.index === 1 && m.value === 1));
  await page.locator('#draw-hw_octave_8').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  assert.ok((await messages(page)).some(m => m.type === 'control' && m.index === 1 && m.value > 0 && m.value < 1));
  await page.locator('#panic').click();
  assert.ok((await messages(page)).some(m => m.type === 'panic'));
  await page.locator('#audio-start').click();
  await page.waitForFunction(() => document.querySelector('#audio-start').getAttribute('aria-pressed') === 'false');
  await context.close();
  return peaks;
}

async function mobile(browser) {
  const context = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await load(context, false);
  await assertLayout(page, false);
  assert.ok(await page.locator('#midi-connect').isDisabled());
  await page.touchscreen.tap(...await point(page, 60));
  await page.waitForFunction(() => document.querySelector('#audio-start').getAttribute('aria-pressed') === 'true');
  assert.equal(await pressed(page, 60), 'false');
  // The first tap can begin and end before the DSP finishes loading.
  const events = (await messages(page)).flatMap(m => m.type === 'configure' ? m.notes : [m]);
  assert.deepEqual(events.filter(m => m.note === 60).map(m => [m.type, m.division]), [['divisionNoteOn', 0], ['divisionNoteOff', 0]]);

  const touch = await context.newCDPSession(page);
  await page.locator('#keyboard').scrollIntoViewIfNeeded();
  const before = (await messages(page)).length;
  const contact = async (note, division, id) => {
    const [x, y] = await point(page, note, division);
    return { x, y, id };
  };
  const samePitch = 48;
  const contacts = await Promise.all([0, 1, 3].map(division => contact(samePitch, division, division + 1)));
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts });
  for (const division of [0, 1, 3]) assert.equal(await pressed(page, samePitch, division), 'true');
  assert.equal(await pressed(page, samePitch, 2), 'false');
  contacts[0] = await contact(50, 0, 1);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contacts });
  assert.equal(await pressed(page, samePitch, 0), 'false');
  assert.equal(await pressed(page, 50, 0), 'true');
  for (const division of [1, 3]) assert.equal(await pressed(page, samePitch, division), 'true');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  for (const division of [0, 1, 3]) assert.equal(await pressed(page, samePitch, division), 'false');
  assert.equal(await pressed(page, 50, 0), 'false');
  const played = (await messages(page)).slice(before);
  for (const division of [0, 1, 3]) {
    assert.deepEqual(played.filter(event => event.note === samePitch && event.division === division).map(event => event.type),
      ['divisionNoteOn', 'divisionNoteOff']);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await assertLayout(page, false);
  await page.touchscreen.tap(...await point(page, 62, 2));
  const lastTwo = (await messages(page)).slice(-2);
  assert.deepEqual(lastTwo.map(({ type, division, note }) => [type, division, note]),
    [['divisionNoteOn', 2, 62], ['divisionNoteOff', 2, 62]]);
  await context.close();
}

async function fallback(browser, cause) {
  const context = await browser.newContext();
  if (cause === 'unsupported') {
    // Reject modules containing the SIMD opcode prefix in the feature probe.
    // All other WebAssembly checks and the AudioWorklet still run normally.
    await context.addInitScript(() => {
      const validate = WebAssembly.validate;
      WebAssembly.validate = (source, ...options) => {
        const bytes = ArrayBuffer.isView(source)
          ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
        return !bytes.includes(0xfd) && validate(source, ...options);
      };
    });
  }
  const page = await load(context, false);
  let blocked = false;
  if (cause === 'fetch failure' || cause === 'worklet initialization failure') {
    await page.route('**' + simdPath, route => {
      blocked = true;
      if (cause === 'fetch failure') return route.abort('failed');
      // This valid module compiles and crosses into the audio thread. Its
      // missing organ exports cause accelerated processor construction to fail.
      return route.fulfill({ contentType: 'application/wasm', body: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]) });
    });
  }
  await page.keyboard.down('KeyQ');
  await waitForStereo(page);
  assert.equal(await page.locator('#audio-status').getAttribute('data-renderer'), 'javascript', cause);
  assert.ok(servedPaths.has(javascriptPath), 'The JavaScript DSP must be loaded for ' + cause);
  assert.ok(!servedPaths.has(simdPath), 'Unexpected successful SIMD download during ' + cause);
  if (cause !== 'unsupported') assert.ok(blocked, 'SIMD request was never attempted');
  await page.keyboard.up('KeyQ');
  assert.equal(await pressed(page, 60), 'false');
  await context.close();
}

let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const peaks = await desktop(browser);
  await mobile(browser);
  await fallback(browser, 'unsupported');
  await fallback(browser, 'fetch failure');
  await fallback(browser, 'worklet initialization failure');
  assert.deepEqual(errors, []);
  console.log('Oregana Chromium checks passed: four independent divisions, all controls and registrations, desktop, touch, MIDI, stereo SIMD and JavaScript fallback. Peaks:', peaks);
} finally {
  await browser?.close();
  server.close();
}
