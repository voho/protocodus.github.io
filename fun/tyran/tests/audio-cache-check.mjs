// A replaced soundtrack must reach players who cached the previous one: songs
// and effects are validated against their shipped byte counts, stale copies are
// fetched again from the network, and older cache versions are removed.
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
  const { SONGS, AUDIO_CACHE, audioAssets } = await import('./audio-assets.js');
  const names = await caches.keys();
  const cache = await caches.open(AUDIO_CACHE);
  const stored = {};
  for (const [key, song] of Object.entries(SONGS)) {
    const hit = await cache.match(new URL(`./assets/audio/music/${song.file}`, location.href).href);
    stored[key] = hit ? (await hit.blob()).size : null;
  }
  const playing = {};
  for (const [key, songUrl] of audioAssets.songs) playing[key] = (await (await fetch(songUrl)).blob()).size;
  return { names, stored, playing, expected: Object.fromEntries(Object.entries(SONGS).map(([key, song]) => [key, song.bytes])), ready: audioAssets.ready };
});
try {
  await ready();
  const first = await inventory();
  assert(first.ready, 'audio preflight completes');
  assert.deepEqual(first.names.filter(name => name.startsWith('tyran-audio-')), ['tyran-audio-v3'], 'one versioned audio cache');
  assert.deepEqual(first.stored, first.expected, 'every song is cached at its shipped size');
  assert.deepEqual(first.playing, first.expected, 'playback blobs carry the shipped songs');
  // Plant a stale soundtrack: an old cache version plus a wrong-sized copy under the current name.
  await page.evaluate(async () => {
    const { SONGS, AUDIO_CACHE } = await import('./audio-assets.js');
    const old = await caches.open('tyran-audio-v2');
    await old.put(new URL('./assets/audio/music/1.mp3', location.href).href, new Response(new Uint8Array(1234), { headers: { 'Content-Type': 'audio/mpeg' } }));
    const cache = await caches.open(AUDIO_CACHE);
    for (const song of Object.values(SONGS).slice(0, 2)) await cache.put(new URL(`./assets/audio/music/${song.file}`, location.href).href, new Response(new Uint8Array(4096), { headers: { 'Content-Type': 'audio/mpeg' } }));
    await cache.put(new URL('./assets/audio/sfx/pickup-1.wav', location.href).href, new Response(new Uint8Array(77), { headers: { 'Content-Type': 'audio/wav' } }));
  });
  await ready();
  const repaired = await inventory();
  assert.deepEqual(repaired.names.filter(name => name.startsWith('tyran-audio-')), ['tyran-audio-v3'], 'the previous cache version is removed');
  assert.deepEqual(repaired.stored, repaired.expected, 'stale cached songs are replaced by the shipped files');
  assert.deepEqual(repaired.playing, repaired.expected, 'playback uses the shipped songs, never a stale copy');
  const sample = await page.evaluate(async () => { const { audioAssets } = await import('./audio-assets.js'); return audioAssets.samples.get('pickup-1')?.length || 0; });
  assert(sample > 1000, 'a stale effect is re-fetched and decodes');
  assert.deepEqual(errors, [], 'no runtime errors');
  console.log('PASS versioned audio cache, size validation and stale soundtrack repair');
} finally { await browser.close(); }
