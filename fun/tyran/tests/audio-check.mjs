// Serve the repo root, then set TYRAN_PLAYWRIGHT and optionally TYRAN_URL.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const errors = [];
const setup = async (page, blocked = false) => {
  page.on('pageerror', error => errors.push(error.message));
  if (blocked) await page.route('**/assets/audio/**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.evaluate(async () => {
    const { AudioEngine, preloadAudio } = await import('./audio.js');
    window.audioProgress = [];
    const preload = preloadAudio(progress => audioProgress.push(progress));
    window.sharedAudioPreload = preload === preloadAudio();
    window.audioStatus = await preload;
    window.audioTest = new AudioEngine();
    const button = document.createElement('button'); button.id = 'audio-test-start'; button.textContent = 'Test sound';
    button.style = 'position:fixed;top:0;left:0;z-index:99999';
    button.onclick = () => {
      audioTest.start(); audioTest.update(true);
      if (!window.audioMeter) {
        window.audioMeter = audioTest.context.createAnalyser(); audioMeter.fftSize = 2048;
        audioTest.limiter.connect(audioMeter);
      }
    };
    document.body.append(button);
  });
};
const rms = page => page.evaluate(async () => {
  let peak = 0;
  const data = new Float32Array(audioMeter.fftSize);
  for (let i = 0; i < 12; i++) {
    audioMeter.getFloatTimeDomainData(data);
    peak = Math.max(peak, Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length));
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  return peak;
});
try {
  const context = await browser.newContext(), page = await context.newPage();
  const requests = []; page.on('request', request => { if (request.url().startsWith('http') && request.url().includes('/assets/audio/')) requests.push(request.url()); });
  await setup(page);
  assert.equal(requests.length, 21, 'Preflight completely loads all 18 effects and 3 songs');
  assert.equal(new Set(requests).size, 21, 'Each asset is fetched only once');
  assert.equal(await page.evaluate(() => sharedAudioPreload), true, 'Repeated calls share a single preflight promise');
  assert.deepEqual(await page.evaluate(() => audioStatus), { ready: true, completed: 21, total: 21, loaded: 21, failed: 0 });
  assert.equal(await page.evaluate(() => audioProgress.at(-1).ready), true, 'Progress reports settled readiness');
  assert.equal(await page.evaluate(() => audioTest.context), null, 'Preloading creates no live playback context');
  assert.equal(await page.evaluate(() => audioTest.samples.size), 18, 'All WAVs are already decoded before a user gesture');
  await page.evaluate(() => { audioTest.mute(true); audioTest.start(); });
  assert.equal(await page.evaluate(() => audioTest.context), null, 'A saved mute preference avoids creating audio at launch');
  assert.equal(requests.length, 21, 'Muted launch reuses the completed cache');
  await page.evaluate(() => audioTest.mute(false));
  // Every track and cue must remain usable with the network completely absent.
  await page.context().setOffline(true);
  await page.click('#audio-test-start');
  assert.equal(await page.evaluate(() => audioTest.samples.size), 18, 'All 18 shipped WAVs decode in the browser');
  await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.music.paused);
  assert((await rms(page)) > .001, 'The cached song produces audible samples through the shared limiter');
  const selection = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < 18; i++) { audioTest.stopVoices(); audioTest.sample('pickup', .1); keys.push(audioTest.lastSample.get('pickup')); }
    audioTest.stopVoices();
    for (let i = 0; i < 100; i++) for (const group of ['laser-small', 'explosion', 'pickup', 'impact']) audioTest.sample(group, .1);
    const voices = [...audioTest.sampleVoices].map(voice => voice.group);
    audioTest.pause();
    return { keys, voices, remaining: audioTest.sampleVoices.size + audioTest.synthVoices.size };
  });
  assert(selection.keys.every((key, i, keys) => i === 0 || key !== keys[i - 1]), 'Consecutive cues avoid repeating the same sample');
  assert(selection.voices.length <= 12 && selection.voices.filter(group => group === 'explosion').length <= 4, 'Dense combat has bounded sample concurrency');
  assert.equal(selection.remaining, 0, 'Pausing clears all sample and synth voices');
  assert.equal(await page.evaluate(() => audioTest.music.paused), true);
  const pausedAt = await page.evaluate(() => audioTest.music.currentTime);
  await page.waitForTimeout(150);
  assert(Math.abs(await page.evaluate(() => audioTest.music.currentTime) - pausedAt) < .03, 'Pause freezes song position');
  assert((await rms(page)) < .0001, 'Pause silences actual audio output');
  for (const [mood, key] of [['boss', 'boss'], ['challenge', 'challenge'], ['', 'flight']]) {
    await page.evaluate(mood => audioTest.update(true, 0, mood), mood);
    await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.music.paused);
    assert.equal(await page.evaluate(() => audioTest.songKey), key, 'Arena mood selects its own song');
    assert((await page.evaluate(() => audioTest.music.src)).startsWith('blob:'), 'Music reads complete cached bytes, never a network URL');
    assert((await rms(page)) > .001, 'Each downloaded song routes audible samples into the mixer');
  }
  await page.evaluate(() => audioTest.mute(true));
  assert.equal(await page.evaluate(() => audioTest.music.paused), true, 'Mute pauses streamed music');
  await page.waitForTimeout(150);
  assert((await rms(page)) < .0001, 'Mute silences the shared output');
  await page.evaluate(() => { audioTest.pause(); audioTest.mute(false); audioTest.start(); audioTest.update(false); });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => audioTest.music.paused), true, 'Unmuting in a paused/menu scene does not leave a song playing');
  await page.evaluate(() => audioTest.start());
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => audioTest.music.paused), true, 'A media playing event before the first active frame remains silent');
  await page.evaluate(() => audioTest.update(true));
  await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.music.paused);
  await page.evaluate(() => audioTest.pause());
  await page.evaluate(() => {
    audioTest.originalPlay = audioTest.music.play.bind(audioTest.music);
    audioTest.music.play = () => Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
    audioTest.update(true);
  });
  await page.waitForFunction(() => audioTest.musicBlocked === true);
  const fallbackBeat = await page.evaluate(() => { audioTest.nextBeat = 0; audioTest.update(true); return audioTest.beat; });
  assert(fallbackBeat > 0, 'A rejected playback permission uses synthesized music');
  await page.evaluate(() => { audioTest.music.play = audioTest.originalPlay; });
  await page.click('#audio-test-start');
  await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.musicBlocked);
  await page.evaluate(() => audioTest.pause());
  assert.equal(requests.length, 21, 'Flight, every mood, pause/resume, and retries make no audio network requests');
  await page.context().setOffline(false);
  const cached = await page.context().newPage(), cachedRequests = [];
  cached.on('request', request => { if (request.url().startsWith('http') && request.url().includes('/assets/audio/')) cachedRequests.push(request.url()); });
  await setup(cached);
  assert.equal(await cached.evaluate(() => audioStatus.loaded), 21, 'A later visit restores every audio asset from persistent storage');
  assert.equal(cachedRequests.length, 0, 'Persistent audio cache avoids repeat network downloads');
  await cached.close();

  const fallback = await browser.newPage(), fallbackRequests = [];
  fallback.on('request', request => { if (request.url().startsWith('http') && request.url().includes('/assets/audio/')) fallbackRequests.push(request.url()); });
  await setup(fallback, true);
  assert.deepEqual(await fallback.evaluate(() => audioStatus), { ready: true, completed: 21, total: 21, loaded: 0, failed: 21 }, 'Missing files settle preflight into a usable fallback');
  await fallback.click('#audio-test-start');
  const fallbackState = await fallback.evaluate(() => {
    audioTest.update(true); audioTest.effect('pickup'); audioTest.effect('explosion', 100);
    return { samples: audioTest.samples.size, voices: audioTest.synthVoices.size };
  });
  assert.equal(fallbackState.samples, 0);
  assert(fallbackState.voices > 0, 'Missing audio files retain synthesized effects and music');
  assert((await rms(fallback)) > .001, 'The download-failure fallback is actually audible');
  await fallback.evaluate(() => { audioTest.update(true, 1, 'boss'); audioTest.update(true, 1, 'challenge'); audioTest.pause(); audioTest.start(); });
  assert.equal(fallbackRequests.length, 21, 'Failed preflight assets are not retried during gameplay');
  await fallback.evaluate(() => audioTest.pause());

  // Speed up only the documented shared deadline while leaving requests hung.
  // This proves queued batches cannot each start their own timeout budget.
  const stalled = await browser.newPage(), stalledRequests = [];
  stalled.on('pageerror', error => errors.push(error.message));
  await stalled.route('**/audio-deadline-check.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Audio deadline</title>' }));
  await stalled.route('**/assets/audio/**', route => { stalledRequests.push(route.request().url()); });
  await stalled.goto(new URL('audio-deadline-check.html', url).href);
  const deadline = await stalled.evaluate(async () => {
    const nativeTimeout = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 15000 ? 80 : delay, ...args);
    const { preloadAudio } = await import('./audio-assets.js');
    const before = performance.now(), status = await preloadAudio();
    return { status, elapsed: performance.now() - before };
  });
  assert.deepEqual(deadline.status, { ready: true, completed: 21, total: 21, loaded: 0, failed: 21 });
  assert(deadline.elapsed < 1500, 'One shared deadline settles all queued assets');
  assert(stalledRequests.length <= 4, 'Expired preload does not start another batch of network requests');
  await stalled.close();
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Audio browser checks passed: complete preflight, persistent cache, offline playback of every mood, no in-flight downloads, variation/caps, mute/pause, and asset/permission fallback.');
} finally { await browser.close(); }
