// Run with node tests/oregana/browser.mjs. Set CHROMIUM_PATH to use system Chromium.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url, 'http://localhost');
    const path = resolve(root, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!path.startsWith(resolve(root) + sep)) throw new Error('Invalid path');
    const body = await readFile(path);
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
  await page.locator('#keyboard [data-note="60"]').waitFor();
  return page;
}

async function point(page, note) {
  const key = page.locator('#keyboard [data-note="' + note + '"]');
  await key.scrollIntoViewIfNeeded();
  const box = await key.boundingBox();
  assert.ok(box);
  // Hit the exposed front of a natural key, below its black neighbours.
  return [box.x + box.width / 2, box.y + box.height * 0.83];
}
const pressed = (page, note) => page.locator('#keyboard [data-note="' + note + '"]').getAttribute('aria-pressed');
const messages = page => page.evaluate(() => window.organQA.messages);
const midi = (page, ...data) => page.evaluate(data => window.organQA.midi(...data), data);
async function assertLayout(page) {
  const { pageWidth, viewport, keyLeft, keyRight } = await page.evaluate(() => {
    const keyboard = document.querySelector('#keyboard').getBoundingClientRect();
    return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, keyLeft: keyboard.left, keyRight: keyboard.right };
  });
  assert.ok(pageWidth <= viewport + 1 && keyLeft >= 0 && keyRight <= viewport + 1, 'Console must fit the viewport');
}

async function desktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await load(context, true);
  await assertLayout(page);

  const c = await point(page, 60);
  await page.mouse.move(...c);
  await page.mouse.down();
  assert.equal(await pressed(page, 60), 'true');
  await page.waitForFunction(() => window.organQA.peaks.every(peak => peak > 0.003) && window.organQA.stereoDifference > 0.0001);
  const peaks = await page.evaluate(() => window.organQA.peaks);
  assert.equal(await page.locator('#audio-start').getAttribute('aria-pressed'), 'true');
  await page.mouse.move(...await point(page, 64), { steps: 5 });
  assert.equal(await pressed(page, 60), 'false');
  assert.equal(await pressed(page, 64), 'true');
  await page.mouse.up();
  assert.equal(await pressed(page, 64), 'false');

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
  assert.deepEqual(sequence.map(m => [m.type, m.velocity]), [['noteOn', 113], ['noteOff', 37]]);

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

  // Playwright selects an option outside the OS picker. Open it with a real
  // pointer first to reproduce choosing a registration, then playing a note.
  const registration = page.locator('#registration');
  await registration.click();
  await registration.selectOption({ label: 'Gedackt 8' });
  await page.keyboard.down('KeyQ');
  assert.equal(await pressed(page, 72), 'true');
  await page.keyboard.up('KeyQ');

  const manual = page.locator('#control-keyboard');
  await manual.click();
  await manual.selectOption('1');
  assert.equal(await page.locator('#keyboard :focus').count(), 1);
  await manual.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await manual.inputValue(), '2');
  await page.keyboard.press('p');
  assert.equal(await manual.inputValue(), '1', 'Keep native manual type-ahead for keyboard navigation');
  assert.equal(await page.locator('#control-keyboard:focus').count(), 1);
  const stop = page.locator('#control-hw_octave_8');
  assert.equal(await stop.getAttribute('aria-pressed'), 'false');
  await stop.click();
  assert.equal(await stop.getAttribute('aria-pressed'), 'true');
  assert.ok((await messages(page)).some(m => m.type === 'control' && m.index === 1 && m.value === 1));
  await page.locator('#fine-draw').check();
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
  await assertLayout(page);
  assert.ok(await page.locator('#midi-connect').isDisabled());
  await page.touchscreen.tap(...await point(page, 60));
  await page.waitForFunction(() => document.querySelector('#audio-start').getAttribute('aria-pressed') === 'true');
  assert.equal(await pressed(page, 60), 'false');
  // The first tap can begin and end before the DSP finishes loading.
  const events = (await messages(page)).flatMap(m => m.type === 'configure' ? m.notes : [m]);
  assert.deepEqual(events.filter(m => m.note === 60).map(m => m.type), ['noteOn', 'noteOff']);

  const touch = await context.newCDPSession(page);
  const [x, y] = await point(page, 60);
  const [secondX, secondY] = await point(page, 64);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: secondX, y: secondY, id: 2 }] });
  assert.equal(await pressed(page, 60), 'true');
  assert.equal(await pressed(page, 64), 'true');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await pressed(page, 60), 'false');
  assert.equal(await pressed(page, 64), 'false');
  await page.setViewportSize({ width: 320, height: 640 });
  await assertLayout(page);
  await context.close();
}

let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const peaks = await desktop(browser);
  await mobile(browser);
  assert.deepEqual(errors, []);
  console.log('Oregana Chromium checks passed: desktop, touch, MIDI, presets, draw stops, stereo worklet. Peaks:', peaks);
} finally {
  await browser?.close();
  server.close();
}
