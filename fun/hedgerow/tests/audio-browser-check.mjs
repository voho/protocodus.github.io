// Real Chromium decoding and OfflineAudioContext rendering. No GPU/world needed.
// Run: CHROMIUM_PATH=/usr/bin/chromium node fun/hedgerow/tests/audio-browser-check.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.js': 'text/javascript', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><title>Hedgerow audio test</title><link rel="icon" href="data:,"></head><body>Audio test</body></html>');
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(resolve(root) + sep) || !(await stat(path)).isFile()) throw new Error('Not found');
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const expectedSamples = JSON.parse(await readFile(new URL('../assets/audio/manifest.json', import.meta.url), 'utf8')).assets.length;
let browser;
try {
  const systemChromium = await stat('/usr/bin/chromium').then(() => '/usr/bin/chromium').catch(() => null);
  const executablePath = process.env.CHROMIUM_PATH || systemChromium;
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage();
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  const reports = await page.evaluate(async () => {
    const { createAudio } = await import('/js/audio.js');
    const cases = [
      { name: 'recorded combat', volume: 0.8, effects: 1, ambience: 0, combat: true },
      { name: 'effects muted', volume: 0.8, effects: 0, ambience: 0, combat: true, daze: 1 },
      { name: 'master muted', volume: 0, effects: 1, ambience: 1, combat: true, daze: 1 },
      { name: 'ambience only', volume: 0.8, effects: 0, ambience: 1, combat: false },
      { name: 'ambience muted', volume: 0.8, effects: 1, ambience: 0, combat: false },
    ];
    const results = [];
    for (const test of cases) {
      let context;
      // Use the real browser implementation to render the complete production
      // graph deterministically, without sending audio to a physical device.
      window.AudioContext = function () { return context = new OfflineAudioContext(2, 22050, 44100); };
      const audio = createAudio();
      audio.setVolume(test.volume);
      audio.setMix({ effects: test.effects, ambience: test.ambience });
      audio.prepare();
      const loaded = await audio.preloadSamples();
      audio.setListener(0, 1.7, 0, 0);
      let occlusionQueries = 0;
      audio.setOcclusionProbe(() => { occlusionQueries++; return { surface: 'stone' }; });
      audio.setOutdoors(true);
      audio.setSpace(0.6, 12);
      if (test.combat) {
        audio.gunshot('garand', 0, 1.7, 0, { player: true });
        audio.gunshot('mp40', 12, 1.7, 0);
        audio.gunshot('mp40', 12, 1.7, 0);
        audio.footstep(-5, 0, 2, 'wood', 1, false, { wet: 0.5, run: true });
        audio.impact(12, 1.7, 0, 'metal');
        audio.reload('garand');
        audio.switchWeapon(); audio.dryFire(); audio.ui();
        audio.gear('crouch'); audio.bodyFall(10, 0, 0, 'mud', 0.1);
        audio.explosion(16, 0, 4, 0.5);
      }
      audio.daze(test.daze || 0);
      const rendered = await context.startRendering();
      let sum = 0, peak = 0, count = 0;
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        for (const value of rendered.getChannelData(c)) { sum += value * value; peak = Math.max(peak, Math.abs(value)); count++; }
      }
      results.push({ name: test.name, loaded, rms: Math.sqrt(sum / count), peak, occlusionQueries });
    }
    return results;
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'all sounds load locally');
  for (const result of reports) {
    assert.equal(result.loaded.loaded, expectedSamples, `${result.name}: browser decodes every recording`);
    assert.equal(result.loaded.failed, 0);
    assert.ok(Number.isFinite(result.rms) && Number.isFinite(result.peak));
    if (result.name.endsWith('muted')) assert.equal(result.peak, 0, `${result.name} must be silent, including echoes and tinnitus`);
    else assert.ok(result.rms > 0.001, `${result.name} must produce audible output`);
    if (result.name === 'recorded combat') assert.ok(result.occlusionQueries < 7, 'repeated same-cell events reuse obstruction query');
  }
  console.log(`audio-browser-check: all ${expectedSamples} runtime recordings decoded; combat and ambience render; effects/master/ambience mute correctly, including echoes and tinnitus`);
  console.log(JSON.stringify(reports.map(({ name, rms, peak }) => ({ name, rms: +rms.toFixed(5), peak: +peak.toFixed(5) }))));
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
