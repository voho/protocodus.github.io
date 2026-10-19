// Replaced effects must reach players who cached the previous ones: effects
// are validated against their shipped byte counts, stale copies are fetched
// again from the network, and older cache versions (including the complete
// songs earlier releases stored) are removed. Songs stream and are never stored.
// Run with: node fun/tyran/tests/audio-cache-check.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { localStorage.setItem('tyran-muted', 'true'); });
const ready = async () => { await page.goto(url); await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { timeout: 120000 }); };
const inventory = () => page.evaluate(async () => {
  const { SAMPLE_BYTES, AUDIO_CACHE, audioAssets } = await import('./audio-assets.js');
  const names = await caches.keys();
  const cache = await caches.open(AUDIO_CACHE);
  const stored = {};
  for (const key of Object.keys(SAMPLE_BYTES)) {
    const hit = await cache.match(new URL(`./assets/audio/sfx/${key}.wav`, location.href).href);
    stored[key] = hit ? (await hit.arrayBuffer()).byteLength : null;
  }
  const songs = (await cache.keys()).filter(request => request.url.includes('/music/')).length;
  return { names, cacheName: AUDIO_CACHE, stored, songs, expected: { ...SAMPLE_BYTES }, ready: audioAssets.ready };
});
try {
  await ready();
  const first = await inventory();
  assert(first.ready, 'audio preflight completes');
  assert.deepEqual(first.names.filter(name => name.startsWith('tyran-audio-')), [first.cacheName], 'one versioned audio cache');
  assert.deepEqual(first.stored, first.expected, 'every effect is cached at its shipped size');
  assert.equal(first.songs, 0, 'songs stream and are never stored');
  // Plant what an earlier release left behind: an old cache version holding a
  // complete song, plus a wrong-sized copy of an effect under the current name.
  await page.evaluate(async () => {
    const { AUDIO_CACHE } = await import('./audio-assets.js');
    const old = await caches.open('tyran-audio-v4');
    await old.put(new URL('./assets/audio/music/1.mp3', location.href).href, new Response(new Uint8Array(4096), { headers: { 'Content-Type': 'audio/mpeg' } }));
    const cache = await caches.open(AUDIO_CACHE);
    await cache.put(new URL('./assets/audio/sfx/pickup-1.wav', location.href).href, new Response(new Uint8Array(77), { headers: { 'Content-Type': 'audio/wav' } }));
  });
  await ready();
  const repaired = await inventory();
  assert.deepEqual(repaired.names.filter(name => name.startsWith('tyran-audio-')), [repaired.cacheName], 'the previous cache version and its stored songs are removed');
  assert.deepEqual(repaired.stored, repaired.expected, 'a stale cached effect is replaced by the shipped file');
  const sample = await page.evaluate(async () => { const { audioAssets } = await import('./audio-assets.js'); return audioAssets.samples.get('pickup-1')?.length || 0; });
  assert(sample > 1000, 'a stale effect is re-fetched and decodes');
  assert.deepEqual(errors, [], 'no runtime errors');
  console.log('PASS versioned effect cache, size validation, stale effect repair and removal of stored songs');
} finally { await browser.close(); }
