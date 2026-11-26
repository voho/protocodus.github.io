// Run with node tests/keyra/browser.mjs. Set CHROMIUM_PATH to use system Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const simdPath = '/fun/keyra/dsp/keyra-simd.wasm';
const javascriptPath = '/fun/keyra/dsp/core.mjs';
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
  const qa = window.pianoQA = { messages: [], peaks: [0, 0], stereoDifference: 0 };
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

  const port = { id: 'keyra-qa', open: async () => {}, name: 'Keyra QA Keyboard', type: 'input', state: 'connected', close: async () => {} };
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
    if (response.url().startsWith(origin + '/fun/keyra/') && response.status() >= 400) {
      errors.push(response.status() + ' ' + response.url());
    }
  });
  await page.goto(origin + '/fun/keyra/');
  await key(page, 60).waitFor();
  return page;
}

function key(page, note) {
  return page.locator('#keyboard [data-note="' + note + '"]');
}
async function point(page, note) {
  const button = key(page, note);
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  assert.ok(box);
  // Hit the exposed front of a natural key, below its black neighbours.
  return [box.x + box.width / 2, box.y + box.height * 0.83];
}
const pressed = (page, note) => key(page, note).getAttribute('aria-pressed');
const messages = page => page.evaluate(() => window.pianoQA.messages);
const midi = (page, ...data) => page.evaluate(data => window.pianoQA.midi(...data), data);

function waitForStereo(page) {
  return page.waitForFunction(() => window.pianoQA.peaks.every(peak => peak > 0.003) && window.pianoQA.stereoDifference > 0.0001);
}


async function exercise(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await load(context, true);

  // A trusted cold pointer press must start the real DSP and preserve the first strike.
  await page.mouse.move(...await point(page, 60));
  await page.mouse.down();
  await waitForStereo(page);
  assert.equal(await pressed(page, 60), 'true');
  assert.equal(await page.locator('#audio-status').getAttribute('data-renderer'), 'simd');
  assert.ok(servedPaths.has(simdPath) && !servedPaths.has(javascriptPath));
  await page.mouse.move(...await point(page, 64), { steps: 4 });
  assert.equal(await pressed(page, 60), 'false');
  assert.equal(await pressed(page, 64), 'true');
  await page.mouse.up();
  assert.equal(await pressed(page, 64), 'false');

  for (let index = 0; index < 13; ++index) {
    const button = page.locator('#preset-' + index);
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
  }
  await page.locator('#preset-0').click();
  await page.locator('#control-width').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  assert.ok((await messages(page)).some(m => m.type === 'control' || m.type === 'setControl'));
  await key(page, 60).focus();
  await page.keyboard.down('KeyZ');
  await page.keyboard.down('KeyQ');
  assert.equal(await pressed(page, 48), 'true');
  assert.equal(await pressed(page, 60), 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await pressed(page, 48), 'false');
  assert.equal(await pressed(page, 60), 'false');
  await page.keyboard.up('KeyQ');
  await page.keyboard.up('KeyZ');

  const pedal = page.locator('#pedal-sustain');
  await page.locator('#midi-connect').click();
  assert.match(await page.locator('#midi-status').innerText(), /Keyra QA Keyboard/);
  const before = (await messages(page)).length;
  await midi(page, 0x94, 60, 104);
  await midi(page, 0x94, 60, 72);
  await page.keyboard.down('KeyQ');
  await midi(page, 0x84, 60, 33);
  await page.keyboard.up('KeyQ');
  assert.equal(await pressed(page, 60), 'true');
  await midi(page, 0x94, 60, 0);
  assert.equal(await pressed(page, 60), 'false');
  const eventTypes = (await messages(page)).slice(before).filter(event => event.note === 60 && event.channel === 5)
    .map(event => [event.type, event.type === 'noteOn' ? event.velocity : null]);
  assert.deepEqual(eventTypes, [['noteOn', 104], ['noteOn', 72], ['noteOff', null], ['noteOff', null]]);

  await pedal.focus();
  await page.keyboard.down('Space');
  assert.equal(await pedal.getAttribute('aria-pressed'), 'true');
  await midi(page, 0xb4, 64, 127);
  await page.keyboard.up('Space');
  assert.equal(await pedal.getAttribute('aria-pressed'), 'true');
  await midi(page, 0xb4, 64, 0);
  assert.equal(await pedal.getAttribute('aria-pressed'), 'false');
  await midi(page, 0xb4, 66, 127);
  await midi(page, 0xb4, 67, 127);
  assert.equal(await page.locator('#pedal-sostenuto').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#pedal-soft').getAttribute('aria-pressed'), 'true');
  await midi(page, 0xe4, 0, 96);
  assert.ok((await messages(page)).some(e => e.type === 'pitchBend' && e.channel === 5));
  await midi(page, 0x94, 64, 110);
  await page.evaluate(() => window.pianoQA.connect('disconnected'));
  assert.equal(await pressed(page, 64), 'false');
  assert.equal(await page.locator('#pedal-soft').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => window.pianoQA.connect('connected'));
  await midi(page, 0x94, 67, 94);
  assert.equal(await pressed(page, 67), 'true');
  await page.locator('#panic').click();
  assert.equal(await pressed(page, 67), 'false');
  await context.close();
}

async function fallback(browser, rejectFetch) {
  const context = await browser.newContext({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  if (!rejectFetch) await context.addInitScript(() => {
    WebAssembly.validate = () => false;
  });
  const page = await load(context, false);
  let rejected = false;
  if (rejectFetch) await page.route('**' + simdPath, route => {
    rejected = true;
    return route.abort('failed');
  });
  assert.equal(await page.locator('#midi-connect').isDisabled(), true);
  const contact = await point(page, 60);
  const touch = await context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: contact[0], y: contact[1], id: 1 }] });
  await waitForStereo(page);
  assert.equal(await pressed(page, 60), 'true');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await pressed(page, 60), 'false');
  assert.equal(await page.locator('#audio-status').getAttribute('data-renderer'), 'javascript');
  assert.equal(rejected, rejectFetch);
  assert.ok(servedPaths.has(javascriptPath) && !servedPaths.has(simdPath));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await context.close();
}

let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  await exercise(browser);
  await fallback(browser, false);
  await fallback(browser, true);
  assert.deepEqual(errors, []);
  console.log('Keyra studio passed desktop, mobile, stereo SIMD/JavaScript playback, presets, three pedals and MIDI.');
} finally {
  await browser?.close();
  server.close();
}
