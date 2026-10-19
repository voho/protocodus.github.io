// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node fun/tyran/tests/audio-stream-check.mjs
// Songs stream: launch never waits for the soundtrack, and on a slow connection
// the music starts within moments while most of the file is still arriving.
// Nothing synthesized ever stands in for the soundtrack.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const errors = [], songs = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/assets\/audio\/music\//.test(request.url())) songs.push(request.url()); });
  await page.addInitScript(() => {
    localStorage.setItem('tyran-muted', 'false');
    window.audioAudit = { oscillators: 0 };
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { audioAudit.oscillators++; return create.call(this); };
  });
  await page.goto(url);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { timeout: 120000 });
  assert.deepEqual(songs, [], 'Startup downloads no song');
  await page.evaluate(async () => {
    const { AudioEngine } = await import('./audio.js'), update = AudioEngine.prototype.update;
    AudioEngine.prototype.update = function (...args) { window.flightAudio = this; return update.apply(this, args); };
  });
  // About 1.5 Mbit/s: a whole song would take ~25 s to download.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 1.5e6 / 8, uploadThroughput: 1e6 / 8 });
  const clicked = Date.now();
  await page.click('#launch-button');
  await page.evaluate(() => { for (const pilot of tyran.state.players) pilot.hurt = 1e8; });
  await page.waitForFunction(() => window.flightAudio?.musicPlaying && !flightAudio.music.paused, null, { timeout: 20000 });
  const started = (Date.now() - clicked) / 1000;
  assert(started < 8, `Music starts within moments on a slow connection (${started.toFixed(1)} s)`);
  await page.waitForFunction(() => flightAudio.music.currentTime > .5);
  const stream = await page.evaluate(() => {
    const player = flightAudio.music, buffered = player.buffered;
    return { song: flightAudio.songKey, file: player.src.split('/').at(-1), bufferedEnd: buffered.length ? buffered.end(buffered.length - 1) : 0,
      duration: player.duration, oscillators: audioAudit.oscillators };
  });
  assert.deepEqual([stream.song, stream.file], ['flight', '1.mp3']);
  assert(stream.bufferedEnd < stream.duration - 30, `Playback began while the song was still downloading (${stream.bufferedEnd.toFixed(0)} of ${stream.duration.toFixed(0)} s buffered)`);
  assert.equal(stream.oscillators, 0, 'No synthesized music played while the song was buffering');
  // A guardian switches the one element to its own stream.
  await page.evaluate(() => { tyran.state.bossSpawned = true; tyran.state.bossDefeated = false; });
  await page.waitForFunction(() => flightAudio.songKey === 'boss' && flightAudio.musicPlaying && !flightAudio.music.paused, null, { timeout: 20000 });
  assert(songs.some(request => request.endsWith('/music/4.mp3')), 'The guardian track streams when it is needed');
  assert(!songs.some(request => /\/music\/[235]\.mp3$/.test(request)), 'Songs that are not needed are never downloaded');
  assert.equal(await page.evaluate(() => audioAudit.oscillators), 0, 'The soundtrack never fell back to synthesized music');
  assert.deepEqual(errors, []);
  console.log(`Streaming checks passed: no song at startup, music after ${started.toFixed(1)} s at 1.5 Mbit/s with ${stream.bufferedEnd.toFixed(0)} of ${stream.duration.toFixed(0)} s buffered, guardian track streamed on demand, no synthesized stand-in.`);
} finally { await browser.close(); }
