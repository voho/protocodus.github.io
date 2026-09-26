// Serve the repo root, then set TYRAN_PLAYWRIGHT and optionally TYRAN_URL.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const errors = [];
const setup = async (page, blocked = false) => {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.audioMediaAudit = { players: [], sources: 0, loads: 0, plays: 0, contexts: 0, authorized: new Set() };
    const NativeAudio = window.Audio, NativeContext = window.AudioContext;
    window.Audio = new Proxy(NativeAudio, { construct(target, args) {
      const player = Reflect.construct(target, args); audioMediaAudit.players.push(player); return player;
    } });
    window.AudioContext = new Proxy(NativeContext, { construct(target, args) {
      audioMediaAudit.contexts++; return Reflect.construct(target, args);
    } });
    const prototype = HTMLMediaElement.prototype, src = Object.getOwnPropertyDescriptor(prototype, 'src');
    Object.defineProperty(prototype, 'src', { ...src, set(value) { audioMediaAudit.sources++; src.set.call(this, value); } });
    for (const [method, counter] of [['load', 'loads'], ['play', 'plays']]) {
      const original = prototype[method];
      prototype[method] = function (...args) {
        audioMediaAudit[counter]++;
        // Explicit permission fixture: CDP evaluation's implicit user gesture
        // must not authorize a media element's first frame-driven play.
        if (method === 'play' && !audioMediaAudit.authorized.has(this)) {
          if (!window.audioTestGesture) return Promise.reject(new DOMException('Element needs gesture', 'NotAllowedError'));
          audioMediaAudit.authorized.add(this);
        }
        return original.apply(this, args);
      };
    }
  });
  if (blocked) await page.route('**/assets/audio/**', route => route.fulfill({ status: 404, body: '' }));
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await page.evaluate(async () => {
    const { AudioEngine, preloadAudio } = await import('./audio.js');
    window.preparedAudio = (await import('./audio-assets.js')).audioAssets;
    window.audioProgress = [];
    const preload = preloadAudio(progress => audioProgress.push(progress));
    window.sharedAudioPreload = preload === preloadAudio();
    window.audioStatus = await preload;
    window.audioTest = new AudioEngine();
    const button = document.createElement('button'); button.id = 'audio-test-start'; button.textContent = 'Test sound';
    button.style = 'position:fixed;top:0;left:0;z-index:99999';
    button.onclick = () => {
      window.audioTestGesture = true;
      try {
        audioTest.start(); audioTest.update(window.audioGestureStartsFlight !== false);
        if (!window.audioMeter) {
          window.audioMeter = audioTest.context.createAnalyser(); audioMeter.fftSize = 2048;
          audioTest.limiter.connect(audioMeter);
        }
      } finally { window.audioTestGesture = false; }
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
  assert.equal(requests.length, 23, 'Preflight completely loads all 18 effects and 5 songs');
  assert.equal(new Set(requests).size, 23, 'Each asset is fetched only once');
  assert.deepEqual(requests.filter(url => url.endsWith('.mp3')).map(url => new URL(url).pathname.split('/').at(-1)).sort(), ['1.mp3', '2.mp3', '3.mp3', '4.mp3', '5.mp3'], 'Only the five supplied songs are requested');
  assert.equal(await page.evaluate(() => sharedAudioPreload), true, 'Repeated calls share a single preflight promise');
  assert.deepEqual(await page.evaluate(() => audioStatus), { ready: true, completed: 23, total: 23, loaded: 23, failed: 0 });
  assert.equal(await page.evaluate(() => audioProgress.at(-1).ready), true, 'Progress reports settled readiness');
  assert.equal(await page.evaluate(() => audioTest.context), null, 'Preloading creates no live playback context');
  assert.equal(await page.evaluate(() => audioTest.samples.size), 18, 'All WAVs are already decoded before a user gesture');
  const prepared = await page.evaluate(() => ({
    created: audioMediaAudit.players.length, sources: audioMediaAudit.sources, loads: audioMediaAudit.loads,
    plays: audioMediaAudit.plays, contexts: audioMediaAudit.contexts,
    keys: [...preparedAudio.players.keys()].sort(),
    ready: [...preparedAudio.players].every(([key, player]) => player.readyState >= 4 && player.preload === 'auto'
      && player.networkState === 1 && player.buffered.length && player.buffered.start(0) <= .05
      && player.buffered.end(player.buffered.length - 1) >= player.duration - .05
      && player.paused && player.loop && player.src === preparedAudio.songs.get(key)),
  }));
  assert.deepEqual(prepared.keys, ['boss', 'challenge', 'flight', 'flight2', 'flight3']);
  assert.equal(prepared.created, 5); assert.equal(prepared.sources, 5); assert.equal(prepared.loads, 5);
  assert.equal(prepared.ready, true, 'Every reusable song player has playable data before readiness');
  assert.equal(prepared.plays, 0); assert.equal(prepared.contexts, 0, 'Preflight neither plays music nor creates a live context');
  await page.evaluate(() => { audioTest.mute(true); audioTest.start(); });
  assert.equal(await page.evaluate(() => audioTest.context), null, 'A saved mute preference avoids creating audio at launch');
  assert.equal(requests.length, 23, 'Muted launch reuses the completed cache');
  await page.evaluate(() => audioTest.mute(false));
  // Every track and cue must remain usable with the network completely absent.
  await page.context().setOffline(true);
  await page.evaluate(() => { window.audioGestureStartsFlight = false; });
  await page.click('#audio-test-start');
  await page.waitForFunction(() => audioTest.musicUnlocks.size === 0 && [...preparedAudio.players.values()].every(player => player.paused));
  assert.equal(await page.evaluate(() => audioMediaAudit.authorized.size), 5, 'One explicit gesture authorizes all five prepared elements');
  assert((await rms(page)) < .0001, 'Priming all players in the menu produces no audible output');
  await page.evaluate(() => { window.audioGestureStartsFlight = true; audioTest.update(true); });
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
  const songSources = new Set();
  for (const [level, mood, key] of [[0, '', 'flight'], [1, '', 'flight2'], [2, '', 'flight3'], [2, 'boss', 'boss'], [2, 'challenge', 'challenge'], [3, '', 'flight'], [10, '', 'flight2'], [20, '', 'flight3']]) {
    await page.evaluate(({level, mood}) => audioTest.update(true, level, mood), {level, mood});
    await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.music.paused);
    assert.equal(await page.evaluate(() => audioTest.songKey), key, 'Sector rotation and combat mood select the intended song');
    const source = await page.evaluate(() => audioTest.music.src); songSources.add(source);
    assert(source.startsWith('blob:'), 'Music reads complete cached bytes, never a network URL');
    assert.equal(await page.evaluate(() => audioTest.music === preparedAudio.players.get(audioTest.songKey)), true, 'Mood changes reuse the original prepared player');
    assert.equal(await page.evaluate(() => [...preparedAudio.players.values()].filter(player => !player.paused).length), 1, 'Only the selected song can play');
    assert((await rms(page)) > .001, 'Each downloaded song routes audible samples into the mixer');
    const channels = await page.evaluate(() => [...audioTest.musicChannels].map(([key, channel]) => [key, channel.gain.value]));
    assert.deepEqual(channels, channels.map(([name]) => [name, name === key ? 1 : 0]),
      'Inactive channels remain silent even if priming play promises finish late');
  }
  assert.equal(songSources.size, 5, 'All five supplied songs play offline');
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
  assert.equal(requests.length, 23, 'Flight, every mood, pause/resume, and retries make no audio network requests');
  assert.deepEqual(await page.evaluate(() => ({ created: audioMediaAudit.players.length, sources: audioMediaAudit.sources, loads: audioMediaAudit.loads })),
    { created: 5, sources: 5, loads: 5 }, 'No player, src assignment or load call occurs after preflight');
  assert.equal(await page.evaluate(() => [...preparedAudio.players.values()].every(player => player.paused)), true, 'Pause/mute/menu never leave an orphan player running');
  await page.evaluate(() => audioTest.update(true, 0, 'boss'));
  await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.music.paused);
  const ownership = await page.evaluate(async () => {
    const inactive = preparedAudio.players.get('flight');
    inactive.dispatchEvent(new Event('waiting')); inactive.dispatchEvent(new Event('playing')); inactive.dispatchEvent(new Event('error'));
    const { AudioEngine } = await import('./audio.js');
    const other = new AudioEngine(); other.start(); other.update(true); other.pause();
    return { playing: audioTest.musicPlaying, paused: audioTest.music.paused, failed: audioTest.failedSongs.has('boss'),
      inactivePaused: inactive.paused, otherPlayers: other.musicPlayers.size, otherFallback: other.musicUnavailable };
  });
  assert.deepEqual(ownership, { playing: true, paused: false, failed: false, inactivePaused: true, otherPlayers: 0, otherFallback: true },
    'Late inactive-song events and a second engine cannot interrupt or claim the selected song');
  await page.evaluate(() => audioTest.pause());
  await page.context().setOffline(false);
  const cached = await page.context().newPage(), cachedRequests = [];
  cached.on('request', request => { if (request.url().startsWith('http') && request.url().includes('/assets/audio/')) cachedRequests.push(request.url()); });
  await setup(cached);
  assert.equal(await cached.evaluate(() => audioStatus.loaded), 23, 'A later visit restores every audio asset from persistent storage');
  assert.equal(cachedRequests.length, 0, 'Persistent audio cache avoids repeat network downloads');
  await cached.evaluate(() => {
    const player = preparedAudio.players.get('challenge');
    window.challengePlay = player.play.bind(player);
    player.play = () => Promise.reject(new DOMException('Element denied', 'NotAllowedError'));
  });
  await cached.click('#audio-test-start');
  await cached.waitForFunction(() => audioTest.musicPlaying && audioTest.blockedSongs.has('challenge'));
  assert.equal(await cached.evaluate(() => audioTest.musicBlocked), false, 'An inactive element permission failure cannot block successful flight music');
  await cached.evaluate(() => { preparedAudio.players.get('challenge').play = challengePlay; });
  await cached.click('#audio-test-start');
  await cached.waitForFunction(() => audioMediaAudit.authorized.size === 5 && !audioTest.blockedSongs.has('challenge'));
  for (const errorName of ['AbortError', 'NotAllowedError']) {
    await cached.evaluate(() => audioTest.update(true));
    await cached.waitForFunction(() => audioTest.musicPlaying && audioTest.songKey === 'flight');
    await cached.evaluate(() => {
      const player = preparedAudio.players.get('flight2');
      window.restorePrimePlay = player.play.bind(player);
      audioTest.unlockedSongs.delete('flight2');
      player.play = () => new Promise((resolve, reject) => { window.rejectOldPrime = reject; });
    });
    await cached.click('#audio-test-start');
    await cached.evaluate(() => { preparedAudio.players.get('flight2').play = restorePrimePlay; audioTest.update(true, 1); });
    await cached.waitForFunction(() => audioTest.musicPlaying && audioTest.songKey === 'flight2');
    const stalePrime = await cached.evaluate(async errorName => {
      const beat = audioTest.beat;
      rejectOldPrime(new DOMException('Old prime rejected', errorName));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      audioTest.update(true, 1);
      return { playing: audioTest.musicPlaying, paused: audioTest.music.paused, blocked: audioTest.musicBlocked,
        failed: audioTest.failedSongs.has('flight2'), beatChanged: audioTest.beat !== beat };
    }, errorName);
    assert.deepEqual(stalePrime, { playing: true, paused: false, blocked: false, failed: false, beatChanged: false },
      `A stale priming ${errorName} cannot overwrite a newer successful play or start synth over it`);
  }
  await cached.evaluate(() => audioTest.pause());
  assert.equal(await cached.evaluate(() => [...preparedAudio.players.values()].every(player => player.paused)), true);
  await cached.waitForTimeout(150); // Let the analyser's previous audible sample window drain.
  assert((await rms(cached)) < .0001, 'Stopping gesture-primed players leaves the shared output silent');
  await cached.close();

  const fallback = await browser.newPage(), fallbackRequests = [];
  fallback.on('request', request => { if (request.url().startsWith('http') && request.url().includes('/assets/audio/')) fallbackRequests.push(request.url()); });
  await setup(fallback, true);
  assert.deepEqual(await fallback.evaluate(() => audioStatus), { ready: true, completed: 23, total: 23, loaded: 0, failed: 23 }, 'Missing files settle preflight into a usable fallback');
  await fallback.click('#audio-test-start');
  const fallbackState = await fallback.evaluate(() => {
    audioTest.update(true); audioTest.effect('pickup'); audioTest.effect('explosion', 100);
    return { samples: audioTest.samples.size, voices: audioTest.synthVoices.size };
  });
  assert.equal(fallbackState.samples, 0);
  assert(fallbackState.voices > 0, 'Missing audio files retain synthesized effects and music');
  assert((await rms(fallback)) > .001, 'The download-failure fallback is actually audible');
  await fallback.evaluate(() => { audioTest.update(true, 1, 'boss'); audioTest.update(true, 1, 'challenge'); audioTest.pause(); audioTest.start(); });
  assert.equal(fallbackRequests.length, 23, 'Failed preflight assets are not retried during gameplay');
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
  assert.deepEqual(deadline.status, { ready: true, completed: 23, total: 23, loaded: 0, failed: 23 });
  assert(deadline.elapsed < 1500, 'One shared deadline settles all queued assets');
  assert(stalledRequests.length <= 4, 'Expired preload does not start another batch of network requests');
  await stalled.close();

  // Cached bytes are insufficient if a browser never prepares playable media.
  // Keep readyState stalled and shorten the one shared budget for this fixture.
  const stalledMedia = await context.newPage();
  stalledMedia.on('pageerror', error => errors.push(error.message));
  await stalledMedia.route('**/audio-media-deadline-check.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Media deadline</title>' }));
  await stalledMedia.goto(new URL('audio-media-deadline-check.html', url).href);
  const mediaDeadline = await stalledMedia.evaluate(async () => {
    const NativeAudio = window.Audio, nativeTimeout = window.setTimeout, revoke = URL.revokeObjectURL.bind(URL);
    const players = [], revoked = [];
    window.setTimeout = (callback, delay, ...args) => nativeTimeout(callback, delay === 15000 ? 1000 : delay, ...args);
    URL.revokeObjectURL = value => { revoked.push(value); revoke(value); };
    window.Audio = new Proxy(NativeAudio, { construct(target, args) {
      const player = Reflect.construct(target, args);
      Object.defineProperty(player, 'readyState', { configurable: true, get: () => 0 }); players.push(player); return player;
    } });
    const { preloadAudio, audioAssets } = await import('./audio-assets.js');
    const before = performance.now(), status = await preloadAudio(), elapsed = performance.now() - before;
    const cleared = players.every(player => player.paused && !player.hasAttribute('src'));
    for (const player of players) {
      Object.defineProperty(player, 'readyState', { configurable: true, get: () => 4 }); player.dispatchEvent(new Event('canplaythrough'));
    }
    await Promise.resolve();
    return { status, elapsed, created: players.length, revoked: revoked.length, cleared,
      songs: audioAssets.songs.size, prepared: audioAssets.players.size };
  });
  assert.deepEqual(mediaDeadline.status, { ready: true, completed: 23, total: 23, loaded: 18, failed: 5 });
  assert(mediaDeadline.elapsed < 2500, 'Media preparation shares the existing total deadline');
  assert(mediaDeadline.created > 0 && mediaDeadline.created <= 4);
  assert.equal(mediaDeadline.revoked, mediaDeadline.created, 'Every timed-out player releases its Blob URL');
  assert.equal(mediaDeadline.cleared, true, 'Timed-out elements abort loading and release their source');
  assert.equal(mediaDeadline.songs, 0); assert.equal(mediaDeadline.prepared, 0, 'Late media readiness cannot publish failed tracks');
  await stalledMedia.close();
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Audio browser checks passed: five playable preflight players, offline playback of every mood without source/load changes, persistent cache, ownership and event isolation, variation/caps, mute/pause, and bounded asset/media/permission fallback.');
} finally { await browser.close(); }
