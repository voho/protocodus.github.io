// Serve the repo root, then set TYRAN_PLAYWRIGHT and optionally TYRAN_URL.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
// Every effect variant is preloaded; the five songs stream only while they play.
const { SAMPLE_BYTES } = await import('../audio-assets.js');
const EFFECTS = Object.keys(SAMPLE_BYTES).length;
const isSong = request => /\/assets\/audio\/music\/\d\.mp3$/.test(request);
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
          audioTest.transitionBus.connect(audioMeter);
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
  const effectRequests = () => requests.filter(request => !isSong(request));
  assert.equal(requests.length, EFFECTS, `Preflight loads all ${EFFECTS} effects and no song`);
  assert.equal(new Set(requests).size, EFFECTS, 'Each effect is fetched only once');
  assert.equal(await page.evaluate(() => sharedAudioPreload), true, 'Repeated calls share a single preflight promise');
  assert.deepEqual(await page.evaluate(() => audioStatus), { ready: true, completed: EFFECTS, total: EFFECTS, loaded: EFFECTS, failed: 0 });
  assert.equal(await page.evaluate(() => audioProgress.at(-1).ready), true, 'Progress reports settled readiness');
  assert.equal(await page.evaluate(() => audioTest.context), null, 'Preloading creates no live playback context');
  assert.equal(await page.evaluate(() => audioTest.samples.size), EFFECTS, 'All WAVs are already decoded before a user gesture');
  assert.equal(await page.evaluate(() => [...audioTest.samples.values()].every(buffer => buffer.sampleRate === 44100)), true, 'Effects decode at their full 44.1 kHz rate');
  assert.deepEqual(await page.evaluate(() => ({ players: audioMediaAudit.players.length, plays: audioMediaAudit.plays, contexts: audioMediaAudit.contexts })),
    { players: 0, plays: 0, contexts: 0 }, 'Preflight neither creates a music player nor plays anything');
  const unopenedFade = await page.evaluate(() => {
    audioTest.setTransitionGain(.4); audioTest.setTransitionGain(NaN); audioTest.setTransitionGain('0');
    return { gain: audioTest.transitionGain, context: audioTest.context, muted: audioTest.muted };
  });
  assert.deepEqual(unopenedFade, { gain: .4, context: null, muted: false }, 'A transition can be prepared without creating audio or altering mute');
  await page.evaluate(() => { audioTest.mute(true); audioTest.start(); });
  assert.equal(await page.evaluate(() => audioTest.context), null, 'A saved mute preference avoids creating audio at launch');
  assert.equal(requests.length, EFFECTS, 'A muted launch streams nothing');
  await page.evaluate(() => audioTest.mute(false));

  // The launch gesture starts streaming; outside flight the song pauses at once.
  await page.evaluate(() => { window.audioGestureStartsFlight = false; });
  await page.click('#audio-test-start');
  await page.waitForFunction(() => audioTest.music && audioTest.music.paused && !audioTest.musicPending);
  assert.equal(await page.evaluate(() => audioTest.transitionBus.gain.value), Math.fround(.4), 'The first context inherits the prepared transition gain');
  assert.equal(await page.evaluate(() => audioMediaAudit.authorized.size), 1, 'One gesture authorizes the single music element');
  assert((await rms(page)) < .0001, 'Starting audio in the menu produces no audible music');
  await page.evaluate(() => { window.audioGestureStartsFlight = true; audioTest.setTransitionGain(1); audioTest.update(true); });
  await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.music.paused);
  assert(requests.some(request => request.endsWith('/music/1.mp3')), 'The opening song streams from the server');
  await page.waitForFunction(() => audioTest.music.currentTime > 1);
  assert((await rms(page)) > .001, 'The streamed song is audible through the shared limiter');
  const selection = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < 18; i++) { audioTest.stopVoices(); audioTest.sample('pickup', .1); keys.push(audioTest.lastSample.get('pickup')); }
    audioTest.stopVoices();
    for (let i = 0; i < 100; i++) for (const group of ['laser-small', 'explosion', 'enemy-shot', 'impact', 'deflect']) audioTest.sample(group, .1);
    const busy = audioTest.sampleVoices.size;
    // Announcements keep their own voices even when combat fills its budget.
    const announced = audioTest.sample('pickup', .1) && audioTest.sample('alarm', .1);
    const voices = [...audioTest.sampleVoices].map(voice => voice.group);
    audioTest.pause();
    return { keys, voices, busy, announced, remaining: audioTest.sampleVoices.size + audioTest.synthVoices.size };
  });
  assert(selection.keys.every((key, i, keys) => i === 0 || key !== keys[i - 1]), 'Consecutive cues avoid repeating the same sample');
  assert(selection.busy <= 16 && selection.voices.filter(group => group === 'explosion').length <= 4, 'Dense combat has bounded sample concurrency');
  assert(selection.announced && selection.voices.includes('pickup') && selection.voices.includes('alarm'), 'Rare cues still sound during dense combat');
  assert.equal(selection.remaining, 0, 'Pausing clears all sample and synth voices');
  assert.equal(await page.evaluate(() => audioTest.music.paused), true);
  const pausedAt = await page.evaluate(() => audioTest.music.currentTime);
  await page.waitForTimeout(150);
  assert(Math.abs(await page.evaluate(() => audioTest.music.currentTime) - pausedAt) < .03, 'Pause freezes song position');
  assert((await rms(page)) < .0001, 'Pause silences actual audio output');
  await page.evaluate(() => audioTest.update(true));
  await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.music.paused);
  assert(await page.evaluate(pausedAt => audioTest.music.currentTime >= pausedAt - .05, pausedAt), 'Resuming the same song continues where it paused');
  const player = await page.evaluateHandle(() => audioTest.music);
  for (const [level, mood, key, file] of [[0, '', 'flight', '1.mp3'], [1, '', 'flight2', '2.mp3'], [2, '', 'flight3', '3.mp3'], [2, 'boss', 'boss', '4.mp3'], [2, 'challenge', 'challenge', '5.mp3'], [3, '', 'flight', '1.mp3'], [10, '', 'flight2', '2.mp3'], [20, '', 'flight3', '3.mp3']]) {
    await page.evaluate(({ level, mood }) => audioTest.update(true, level, mood), { level, mood });
    await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.music.paused);
    assert.equal(await page.evaluate(() => audioTest.songKey), key, 'Sector rotation and combat mood select the intended song');
    assert(await page.evaluate(file => audioTest.music.src.endsWith(`/assets/audio/music/${file}`), file), 'Each song streams from its own file');
    assert.equal(await page.evaluate(first => audioTest.music === first, player), true, 'Every song streams through the same authorized element');
    // Measure past each song's opening second; some intros start very quietly.
    await page.waitForFunction(() => audioTest.music.currentTime > 1);
    assert((await rms(page)) > .001, 'Each streamed song routes audible samples into the mixer');
  }
  assert.equal(await page.evaluate(() => audioMediaAudit.players.length), 1, 'One music element serves every song');
  const fade = await page.evaluate(async () => {
    audioTest.update(true, 2, 'challenge');
    audioTest.tone(440, 440, 2, .18); audioTest.sample('explosion', .3, .8, 2);
    const levels = [];
    for (const value of [.8, .5, .2, .05, 0]) {
      audioTest.setTransitionGain(value);
      await new Promise(resolve => setTimeout(resolve, 24));
      levels.push(audioTest.transitionBus.gain.value);
    }
    // Newly emitted effects and the still-playing stream all share the final
    // bus; silence cannot depend solely on stopping preexisting voices.
    audioTest.effect('nova', 100); audioTest.sample('pickup', .3);
    return { levels, gain: audioTest.transitionGain, muted: audioTest.muted,
      musicPaused: audioTest.music.paused, samples: audioTest.sampleVoices.size, synths: audioTest.synthVoices.size };
  });
  assert(fade.levels.every((gain, i, values) => i === 0 || gain <= values[i - 1]));
  assert.equal(fade.levels.at(-1), 0); assert.equal(fade.gain, 0); assert.equal(fade.muted, false);
  assert.equal(fade.musicPaused, false); assert(fade.samples > 0 && fade.synths > 0, 'All three kinds of live audio are tested behind the fade');
  await page.waitForTimeout(100);
  assert.equal(await rms(page), 0, 'Black-frame gain0 silences music, decoded samples and synths exactly');
  await page.evaluate(() => { audioTest.mute(true); audioTest.setTransitionGain(3); });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => audioTest.transitionGain), 1, 'Transition gain clamps to unity');
  assert.equal(await page.evaluate(() => audioTest.muted), true, 'Restoring transition gain never clears the user mute');
  assert((await rms(page)) < .0001);
  await page.evaluate(() => { audioTest.setTransitionGain(-2); audioTest.mute(false); audioTest.effect('upgrade'); });
  // AudioParam.value reflects the audio rendering thread's last quantum, so
  // let that thread consume the setValueAtTime endpoint before reading it.
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(() => audioTest.transitionBus.gain.value), 0, 'Unmuting never overrides a black-frame fade');
  await page.waitForTimeout(100); assert.equal(await rms(page), 0);
  await page.evaluate(() => { audioTest.pause(); audioTest.setTransitionGain(1); });
  await page.waitForTimeout(30);
  await page.evaluate(() => audioTest.effect('upgrade'));
  assert((await rms(page)) > .001, 'Restored transition gain makes hangar purchase effects audible');
  await page.evaluate(() => { audioTest.stopVoices(); audioTest.update(true); });
  await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.music.paused);
  await page.waitForTimeout(600);
  assert((await rms(page)) > .001, 'The next flight returns to normal music volume');
  await page.evaluate(() => audioTest.mute(true));
  assert.equal(await page.evaluate(() => audioTest.music.paused), true, 'Mute pauses streamed music');
  await page.waitForTimeout(150);
  assert((await rms(page)) < .0001, 'Mute silences the shared output');
  await page.evaluate(() => { audioTest.pause(); audioTest.mute(false); audioTest.start(); audioTest.update(false); });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => audioTest.music.paused), true, 'Unmuting in a paused/menu scene does not leave a song playing');

  // A refused play stays silent, never a stand-in tune, and the next key press retries it.
  await page.evaluate(() => {
    audioTest.originalPlay = audioTest.music.play.bind(audioTest.music);
    audioTest.music.play = () => Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
    audioTest.update(true);
  });
  await page.waitForFunction(() => audioTest.musicBlocked === true);
  const blockedVoices = await page.evaluate(() => { audioTest.update(true); audioTest.update(true); return audioTest.synthVoices.size + audioTest.sampleVoices.size; });
  assert.equal(blockedVoices, 0, 'A refused playback permission stays silent instead of playing a stand-in tune');
  await page.evaluate(() => { audioTest.music.play = audioTest.originalPlay; });
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => audioTest.musicPlaying && !audioTest.musicBlocked);

  // An unplayable song is skipped for another track; it is retried on the next start.
  await page.evaluate(() => { audioTest.update(true, 0, ''); });
  await page.route('**/assets/audio/music/4.mp3', route => route.fulfill({ status: 404, body: '' }));
  await page.evaluate(() => audioTest.update(true, 0, 'boss'));
  await page.waitForFunction(() => audioTest.failedSongs.has('boss'));
  // The test engine has no frame loop; each poll stands in for a rendered frame.
  await page.waitForFunction(() => { audioTest.update(true, 0, 'boss'); return audioTest.musicPlaying && audioTest.songKey === 'flight' && !audioTest.music.paused; });
  assert.equal(await page.evaluate(() => audioTest.synthVoices.size), 0, 'A missing guardian track keeps a flight song playing, not a synthesized tune');
  await page.unroute('**/assets/audio/music/4.mp3');
  await page.evaluate(() => { audioTest.pause(); audioTest.start(); audioTest.update(true, 0, 'boss'); });
  await page.waitForFunction(() => audioTest.musicPlaying && audioTest.songKey === 'boss');
  await page.evaluate(() => audioTest.pause());
  assert.deepEqual(effectRequests().length, EFFECTS, 'Flight, every mood, pause/resume and retries download no effect again');
  assert.equal(await page.evaluate(() => audioTest.music.paused), true, 'Pause/mute/menu never leave the stream playing');

  const cached = await page.context().newPage(), cachedRequests = [];
  cached.on('request', request => { if (request.url().startsWith('http') && request.url().includes('/assets/audio/')) cachedRequests.push(request.url()); });
  await setup(cached);
  assert.equal(await cached.evaluate(() => audioStatus.loaded), EFFECTS, 'A later visit restores every effect from persistent storage');
  assert.equal(cachedRequests.length, 0, 'Persistent effect cache avoids repeat network downloads');
  assert.equal(await cached.evaluate(async () => {
    const { AUDIO_CACHE } = await import('./audio-assets.js');
    const keys = await (await caches.open(AUDIO_CACHE)).keys();
    return keys.some(request => request.url.includes('/music/'));
  }), false, 'Songs are never copied into persistent storage');
  await cached.close();

  const fallback = await browser.newPage(), fallbackRequests = [];
  fallback.on('request', request => { if (request.url().startsWith('http') && request.url().includes('/assets/audio/')) fallbackRequests.push(request.url()); });
  await setup(fallback, true);
  assert.deepEqual(await fallback.evaluate(() => audioStatus), { ready: true, completed: EFFECTS, total: EFFECTS, loaded: 0, failed: EFFECTS }, 'Missing files settle preflight into a usable fallback');
  await fallback.click('#audio-test-start');
  await fallback.waitForFunction(() => { audioTest.update(true); return ['boss', 'challenge', 'flight', 'flight2', 'flight3'].every(key => audioTest.failedSongs.has(key)); });
  const fallbackState = await fallback.evaluate(() => {
    audioTest.update(true); audioTest.update(true, 1, 'boss');
    const music = audioTest.synthVoices.size;
    audioTest.effect('pickup'); audioTest.effect('explosion', 100);
    return { samples: audioTest.samples.size, music, voices: audioTest.synthVoices.size, playing: audioTest.musicPlaying };
  });
  assert.equal(fallbackState.samples, 0);
  assert.deepEqual([fallbackState.music, fallbackState.playing], [0, false], 'Missing songs leave the soundtrack silent; no synthesized stand-in tune plays');
  assert(fallbackState.voices > 0, 'Missing effect files fall back to synthesized effects');
  assert((await rms(fallback)) > .001, 'The download-failure fallback is actually audible');
  await fallback.evaluate(() => { audioTest.setTransitionGain(0); audioTest.update(true, 1, 'challenge'); audioTest.effect('challenge-result'); });
  await fallback.waitForTimeout(100);
  assert.equal(await rms(fallback), 0, 'Synthesized fallback effects and result fanfare fade to exact silence too');
  await fallback.evaluate(() => { audioTest.pause(); audioTest.setTransitionGain(1); audioTest.effect('upgrade'); });
  assert((await rms(fallback)) > .001, 'Fallback purchase cues recover after the transition');
  await fallback.evaluate(() => { audioTest.update(true, 1, 'boss'); audioTest.update(true, 1, 'challenge'); audioTest.pause(); });
  assert.equal(fallbackRequests.filter(request => !isSong(request)).length, EFFECTS, 'Failed effects are not retried during gameplay');
  const songAttempts = fallbackRequests.filter(isSong).length;
  await fallback.evaluate(() => { audioTest.update(true, 1, 'boss'); audioTest.update(true, 2, ''); });
  await fallback.waitForTimeout(200);
  assert.equal(fallbackRequests.filter(isSong).length, songAttempts, 'Failed songs are not retried until the next start');
  await fallback.evaluate(() => audioTest.pause());

  // Speed up only the documented startup deadline while leaving requests hung.
  // Launch waits one shared budget; hung downloads stay in flight without
  // each queued file starting another request.
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
  assert.deepEqual(deadline.status, { ready: true, completed: 0, total: EFFECTS, loaded: 0, failed: 0 });
  assert(deadline.elapsed < 1500, 'One shared deadline releases the launch while downloads are still pending');
  assert(stalledRequests.length <= 4, 'At most four effect downloads at once; queued files wait their turn');
  await stalled.close();
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log(`Audio browser checks passed: ${EFFECTS} full-rate effects preloaded and cached, songs streamed on demand through one authorized element, rotation and moods, pause/resume position, mute, exact transition silence and recovery, silent (never synthesized) missing music, substitute and retry for an unplayable song, gesture retry, and bounded effect fallback.`);
} finally { await browser.close(); }
