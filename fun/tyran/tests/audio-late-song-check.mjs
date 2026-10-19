// Serve repo root; TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs node fun/tyran/tests/audio-late-song-check.mjs
// A connection too slow to finish the soundtrack before launch: flight starts
// silent (no synthesized stand-in tune), the opening song joins as soon as its
// download completes without another click, a pending guardian track keeps the
// current song playing until it arrives, and each finished song is cached.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const errors = [], held = new Map();
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('tyran-muted', 'false');
    // Shorten only the launch budget, so the test need not wait 15 s.
    const nativeTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 15000 ? 400 : delay, ...args);
    window.audioAudit = { oscillators: 0 };
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { audioAudit.oscillators++; return create.call(this); };
  });
  // Every song download hangs until the test lets it through.
  await page.route('**/assets/audio/music/*.mp3', route => new Promise(release => {
    let released = false;
    held.set(new URL(route.request().url()).pathname.split('/').at(-1), () => {
      if (!released) { released = true; release(route.continue().catch(() => {})); }
    });
  }));
  await page.goto(url);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { timeout: 120000 });
  const launch = await page.evaluate(async () => {
    const { audioAssets } = await import('./audio-assets.js');
    const { AudioEngine } = await import('./audio.js'), update = AudioEngine.prototype.update;
    AudioEngine.prototype.update = function (...args) { window.flightAudio = this; return update.apply(this, args); };
    return { players: audioAssets.players.size, ready: audioAssets.ready };
  });
  assert.deepEqual(launch, { players: 0, ready: true }, 'Launch is not held hostage by a slow soundtrack');
  assert.deepEqual([...held.keys()], ['1.mp3'], 'Songs download one at a time, opening flight track first');

  await page.click('#launch-button');
  await page.waitForFunction(() => window.flightAudio?.context?.state === 'running' && tyran.scene === 'playing');
  await page.evaluate(() => { for (const pilot of tyran.state.players) pilot.hurt = 1e8; });
  await page.waitForTimeout(800);
  const silent = await page.evaluate(() => ({ playing: flightAudio.musicPlaying, oscillators: audioAudit.oscillators }));
  assert.deepEqual(silent, { playing: false, oscillators: 0 }, 'No song yet: silence, never the old synthesized tune');

  held.get('1.mp3')();
  await page.waitForFunction(() => flightAudio.musicPlaying && flightAudio.songKey === 'flight' && !flightAudio.music.paused, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => flightAudio.music.src.startsWith('blob:')), true, 'The late song still plays from memory');
  await page.waitForFunction(async () => {
    const { AUDIO_CACHE } = await import('./audio-assets.js');
    return Boolean(await (await caches.open(AUDIO_CACHE)).match(new URL('./assets/audio/music/1.mp3', location.href).href));
  });

  // A guardian appears before its track has arrived: the flight song carries on.
  for (let i = 0; i < 40 && !held.has('4.mp3'); i++) await page.waitForTimeout(50);
  assert(held.has('4.mp3'), 'The guardian track is the next download');
  await page.evaluate(() => { tyran.state.bossSpawned = true; tyran.state.bossDefeated = false; });
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => ({ key: flightAudio.songKey, playing: flightAudio.musicPlaying })), { key: 'flight', playing: true },
    'A pending track keeps the current song playing');
  held.get('4.mp3')();
  await page.waitForFunction(() => flightAudio.songKey === 'boss' && flightAudio.musicPlaying && !flightAudio.music.paused, null, { timeout: 30000 });
  assert.equal(await page.evaluate(() => audioAudit.oscillators), 0, 'The soundtrack never fell back to synthesized music');
  assert.deepEqual(errors, []);
  console.log('Late soundtrack checks passed: silent launch without a stand-in tune, opening song joins mid-flight, substitute during a pending guardian track, finished songs cached.');
} finally { for (const release of held.values()) release(); await browser.close(); }
