// Serve the repository root; use the same ASHLINE_URL and ASHLINE_PLAYWRIGHT settings as browser-check.mjs.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const base = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const output = process.env.ASHLINE_SCREENSHOTS || '/tmp/ashline-audio-check';
mkdirSync(output, { recursive: true });
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
try {
  // The engine on a bare page: gesture unlock, lazy synthesis, mixer, voice manager, settings and result cues.
  const page = await browser.newPage(); watch(page);
  await page.route('**/audio-check.html', route => route.fulfill({ contentType: 'text/html', body: '<button id="enable">Enable audio</button>' }));
  await page.goto(new URL('audio-check.html', base).href);
  await page.evaluate(async () => {
    window.generated = []; window.pans = []; window.longTasks = [];
    const createBuffer = AudioContext.prototype.createBuffer;
    AudioContext.prototype.createBuffer = function (...args) { const buffer = createBuffer.apply(this, args); generated.push(buffer); return buffer; };
    const createStereoPanner = AudioContext.prototype.createStereoPanner;
    AudioContext.prototype.createStereoPanner = function () { const node = createStereoPanner.call(this); pans.push(node); return node; };
    const audio = await import('./audio.js');
    Object.assign(window, { audioModule: audio, sound: audio.createAudio() });
    // Long tasks are counted from the end of the gesture: the bank must load without blocking input.
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.startTime >= window.gestureEnd) longTasks.push(entry.duration); }).observe({ type: 'longtask' });
    window.gestureEnd = Infinity;
    document.querySelector('#enable').onclick = () => {
      const started = performance.now(); window.unlocking = sound.unlock(); window.unlockMs = performance.now() - started; window.gestureEnd = performance.now();
    };
  });
  assert.equal(await page.evaluate(() => sound.status.contextState), 'locked', 'No audio context or playback before a gesture');
  assert.equal(await page.evaluate(() => sound.play('rifle')), false);
  await page.locator('#enable').click();
  await page.waitForFunction(() => sound.status.contextState === 'running' && sound.status.musicPlaying);
  await page.waitForFunction(() => sound.status.bank.ready, null, { timeout: 30000 });
  const bank = await page.evaluate(() => ({ ...sound.status.bank, ...sound.status.startup, unlockMs, longest: Math.max(0, ...longTasks), size: audioModule.BANK_SIZE }));
  assert.equal(bank.mode, 'worker', 'The bank renders in a module worker');
  // The browser's own audio-device start (the context constructor) varies with machine load; Ashline's setup must not.
  assert(bank.setupMs < 40 && bank.unlockMs - bank.contextMs < 60, `The first gesture stays responsive (${bank.setupMs.toFixed(1)} ms setup, ${bank.contextMs.toFixed(1)} ms device start)`);
  assert(bank.mainMs < 80 && bank.longestMs < 16, `Buffer hand-off costs ${bank.mainMs.toFixed(1)} ms of main-thread time, at most ${bank.longestMs.toFixed(1)} ms at once`);
  assert(bank.longest < 150, `No long main-thread task while the bank loads (${bank.longest} ms)`);
  const buffers = await page.evaluate(() => generated.map(buffer => {
    const data = buffer.getChannelData(0);
    return { peak: data.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0), rms: Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length), finite: data.every(Number.isFinite) };
  }));
  assert.equal(buffers.length, bank.size, 'Every recipe variant has exactly one generated buffer');
  assert.equal(bank.loaded, bank.size);
  assert(buffers.every(buffer => buffer.finite && buffer.peak > .03 && buffer.peak < 1 && buffer.rms > .001), 'Generated effects are audible, finite, and do not clip');

  // Every cue plays; full categories steal their quietest voice instead of dropping new sounds.
  const played = await page.evaluate(() => audioModule.SOUND_KINDS.filter(kind => sound.play(kind)).length);
  assert.equal(played, await page.evaluate(() => audioModule.SOUND_KINDS.length), 'All distinct effects play');
  let status = await page.evaluate(() => sound.status);
  for (const [category, cap] of Object.entries(await page.evaluate(() => audioModule.VOICE_CAPS))) assert((status.voicesByCategory[category] || 0) <= cap, `${category} voices stay within ${cap}`);
  assert(status.stolen > 0 && status.dropped === 0, 'Saturated categories steal voices');
  assert(status.ducking.combat > .3 && status.ducking.music > .2, 'Alerts duck combat and music');
  assert.equal(await page.evaluate(() => sound.play('organics.artillery')), false, 'Repeated combat effects are rate limited');
  assert(await page.evaluate(() => sound.status.aggregated) > 0, 'A repeated shot reinforces the voice already playing');
  assert.equal(await page.evaluate(async () => {
    const { RECIPES } = await import('./soundbank.js');
    await new Promise(resolve => setTimeout(resolve, 500));
    for (const kind of audioModule.SOUND_KINDS) if (RECIPES[kind].category !== 'alert') sound.play(kind);
    const full = Object.entries(audioModule.VOICE_CAPS).every(([category, cap]) => sound.status.voicesByCategory[category] === cap);
    return full && sound.play('alert.objectiveFailed');
  }), true, 'Alerts are never dropped, even with every capped category full');
  await page.waitForFunction(() => sound.status.activeVoices === 0 && sound.status.ducking.combat === 0, null, { timeout: 8000 });
  const pan = await page.evaluate(() => { const before = pans.length; sound.play('aiUnity.tank', { pan: -.6, gain: .5 }); return pans.slice(before).map(node => node.pan.value); });
  assert.deepEqual(pan.map(value => Math.round(value * 100) / 100), [-.6], 'Positioned cues pan through a stereo panner');
  assert.equal(await page.evaluate(() => sound.play('organics.scout', { pan: .85, gain: .3, distant: true })), true, 'Distant combat plays through the muffled bus');
  // Fog safety end to end: a hidden shooter left of the view is placed at its visible impact, right of centre.
  const fog = await page.evaluate(async () => {
    const { createGame } = await import('./sim.js'), { createSoundscape } = await import('./soundscape.js');
    const s = createGame('audio-fog', 'normal', { width: 72, height: 56, aiTeams: [], races: ['organics', 'aiUnity'] });
    s.fogClock = Infinity; s.visible[0].fill(0);
    for (let y = 15; y < 25; y++) for (let x = 30; x < 40; x++) s.visible[0][y * s.width + x] = 1;
    const scape = createSoundscape(sound), view = { x: 30, y: 20, zoom: 40 }, screen = { width: 1200, height: 800 };
    const fire = (from, to) => { s.effects.push({ type: 'shot', weapon: 'striker', x: from[0], y: from[1], tx: to[0], ty: to[1], life: .13, maxLife: .13, team: 1 }); scape.tick(s); scape.frame(s, view, screen); };
    scape.reset(s);
    const before = pans.length, played = sound.status.played;
    fire([10, 20], [36, 20]);
    // The frame places its cues before refreshing the ambient beds, whose wind bed adds a centred panner.
    const heard = { pan: pans[before]?.pan.value, played: sound.status.played - played };
    await new Promise(resolve => setTimeout(resolve, 200));
    fire([10, 40], [14, 40]);
    return { ...heard, hidden: sound.status.played - played - heard.played };
  });
  assert(fog.played === 1 && fog.pan > .1, `A hidden shooter is heard only at its visible impact (pan ${fog.pan})`);
  assert.equal(fog.hidden, 0, 'A fight entirely under fog starts no voice');

  // Unit voices render on demand, play once ready and stay monophonic.
  assert.equal(await page.evaluate(() => sound.voice('voice.human.rifle.select', { variant: 0 })), true);
  await page.waitForFunction(() => sound.status.voicesByCategory.voice === 1, null, { timeout: 5000 });
  await page.waitForFunction(() => sound.status.activeVoices === 0, null, { timeout: 5000 });
  await page.evaluate(() => sound.prewarmVoices(['voice.vael.rocket.move', 'voice.unity.tank.attack']));
  await page.waitForFunction(() => sound.status.bank.voices >= 7);
  assert.deepEqual(await page.evaluate(() => [sound.voice('voice.vael.rocket.move'), sound.voice('voice.unity.tank.attack'), sound.status.voicesByCategory.voice]), [true, true, 1], 'A new unit line replaces the previous one');
  assert.equal(await page.evaluate(() => sound.voice('voice.human.wall.select')), false, 'Unknown voice keys are rejected');

  // Ambient beds run beside the voice budget and stop with mute or pause.
  await page.evaluate(() => sound.setAmbient({ wind: { gain: .5 }, lava: { gain: .4, pan: .5 } }));
  await page.waitForFunction(() => sound.status.ambientActive === 2);
  assert.equal(await page.evaluate(() => sound.status.activeVoices <= 1), true, 'Ambient beds are not voices');
  await page.evaluate(() => sound.setSfxEnabled(false));
  status = await page.evaluate(() => sound.status);
  assert.equal(status.activeVoices, 0, 'Muting immediately stops all effects and voices');
  assert.equal(status.ambientActive, 0, 'Muting stops the ambient beds');
  assert.equal(await page.evaluate(() => sound.play('order') || sound.voice('voice.human.tank.move')), false);
  assert.equal(status.musicPlaying, true, 'Music and SFX controls are independent');

  // Pausing suspends the context after a short fade; cues issued while it resumes wait instead of dropping.
  await page.evaluate(() => sound.setPaused(true));
  await page.waitForFunction(() => sound.status.contextState === 'suspended' && !sound.status.musicPlaying);
  const queued = await page.evaluate(() => { sound.setSfxEnabled(true); sound.setPaused(false); const before = sound.status.played; return { ok: sound.play('select'), state: sound.status.contextState, before }; });
  assert(queued.ok && queued.state !== 'running', 'A cue right after resume is accepted before the context runs');
  await page.waitForFunction(before => sound.status.contextState === 'running' && sound.status.played > before && sound.status.musicPlaying, queued.before);
  await page.evaluate(() => sound.setMusicEnabled(false));
  assert.equal(await page.evaluate(() => sound.status.musicPlaying), false);
  assert.equal(await page.evaluate(() => sound.play('order')), true, 'Effects continue when music is muted');

  // Mix settings persist in ashline.audio.v1 and survive damaged or blocked storage.
  const settings = await page.evaluate(() => {
    sound.setVolume('music', .35); sound.setVolume('voices', 2); sound.setVolume('bogus', .5);
    const stored = JSON.parse(localStorage.getItem(audioModule.SETTINGS_KEY));
    const restored = audioModule.createAudio().settings;
    localStorage.setItem(audioModule.SETTINGS_KEY, '{"volumes":{"music":"loud","master":-4},"sfxEnabled":"yes"');
    const damaged = audioModule.createAudio().settings;
    const blocked = audioModule.createAudio({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
    blocked.setVolume('master', .5);
    return { stored, restored, damaged, blocked: blocked.settings };
  });
  assert.deepEqual(settings.stored.volumes, { ...await page.evaluate(() => audioModule.VOLUME_DEFAULTS), music: .35, voices: 1 });
  assert.equal(settings.stored.musicEnabled, false);
  assert.deepEqual(settings.restored, { volumes: settings.stored.volumes, sfxEnabled: true, musicEnabled: false }, 'A new session restores the mix');
  assert.deepEqual(settings.damaged, { volumes: await page.evaluate(() => audioModule.VOLUME_DEFAULTS), sfxEnabled: true, musicEnabled: true }, 'Damaged settings fall back to defaults');
  assert.equal(settings.blocked.volumes.master, .5, 'Blocked storage keeps the session settings');

  const track = await page.evaluate(async () => {
    const response = await fetch('./assets/audio/space-adventure.mp3');
    const bytes = await response.arrayBuffer(), size = bytes.byteLength, context = new AudioContext();
    const decoded = await context.decodeAudioData(bytes); await context.close();
    return { ok: response.ok, bytes: size, duration: decoded.duration, channels: decoded.numberOfChannels };
  });
  assert(track.ok && track.bytes === 5214163 && track.duration > 120 && track.duration < 140 && track.channels === 2, 'Local CC0 music decodes as the complete stereo track');
  assert.equal(await page.evaluate(() => sound.status.musicError), '');

  // Result stingers play over the result menu while the soundtrack fades out and stays stopped.
  await page.evaluate(() => sound.setMusicEnabled(true));
  await page.waitForFunction(() => sound.status.musicPlaying);
  for (const kind of ['victory', 'defeat']) {
    assert.equal(await page.evaluate(kind => { sound.setPaused(true); return sound.play(kind); }, kind), true, `${kind} plays while its result menu is paused`);
    await page.waitForFunction(() => sound.status.contextState === 'running' && sound.status.voicesByCategory.terminal === 1);
    assert.equal(await page.evaluate(() => sound.play('organics.rifle') || sound.voice('voice.human.rifle.select')), false, 'Battle sounds remain suppressed behind the result menu');
    await page.waitForFunction(() => !sound.status.musicPlaying && sound.status.voicesByCategory.terminal === 1, null, { timeout: 4000 });
    await page.waitForFunction(() => sound.status.contextState === 'suspended' && sound.status.activeVoices === 0, null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => sound.status.musicPlaying), false, 'A result cue does not restart the soundtrack');
  }
  await page.evaluate(() => sound.dispose());
  await page.waitForFunction(() => sound.status.contextState === 'closed' && !sound.status.musicPlaying);
  assert.equal(await page.evaluate(() => sound.unlock()), false, 'Disposed audio does not restart');
  // Without module workers the bank renders in short main-thread slices.
  const fallback = await page.evaluate(async () => {
    const Worker = window.Worker; window.Worker = undefined;
    const audio = audioModule.createAudio({ storage: null });
    await audio.unlock(); window.Worker = Worker;
    const started = performance.now();
    while (!audio.status.bank.ready && performance.now() - started < 30000) await new Promise(resolve => setTimeout(resolve, 50));
    const { bank } = audio.status, played = audio.play('select');
    audio.dispose();
    return { ...bank, played };
  });
  assert(fallback.mode === 'main' && fallback.ready && fallback.played, 'The bank falls back to main-thread rendering');
  assert(fallback.longestMs < 80, `Fallback rendering yields between recipes (longest step ${fallback.longestMs.toFixed(1)} ms)`);
  await page.close();

  // In the game: the soundscape hears visible combat, ambience follows the view, and the pause menu mix persists.
  for (const [name, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const game = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 }); watch(game);
    await game.goto(base); await game.waitForFunction(() => window.ashline?.booted);
    await game.locator('#deploy').click();
    await game.waitForFunction(() => ashline.state && !ashline.loading && !ashline.paused, null, { timeout: 120000 });
    await game.waitForFunction(() => ashline.audio.bank.ready && ashline.audio.ambient.wind > 0, null, { timeout: 30000 });
    const before = await game.evaluate(() => ashline.audio.played);
    await game.evaluate(async () => {
      const { addEntity } = await import('./sim.js');
      const s = ashline.state, core = s.entities.find(e => e.team === 0 && e.kind === 'building'), x = core.x + 6, y = core.y + 2;
      for (let i = 0; i < 4; i++) addEntity(s, 1, 'unit', s.teams[1].race === 'aiUnity' ? 'unityRifle' : 'rifle', x + i * .6, y + 3);
      ashline.view.x = x; ashline.view.y = y;
    });
    await game.waitForFunction(previous => ashline.audio.intensity > .1 && ashline.audio.played > previous + 3 && ashline.audio.voicesByCategory.weapon, before, { timeout: 15000 });
    await game.locator('#pause').click();
    await game.waitForFunction(() => document.querySelector('#menu').open && ashline.audio.ambientActive === 0 && ashline.audio.contextState === 'suspended');
    const sliders = await game.evaluate(() => [...document.querySelectorAll('.audio-mix input[type=range]')].map(input => [input.id, input.value, input.getAttribute('aria-valuetext')]));
    assert.deepEqual(sliders.map(([id]) => id), ['volume-master', 'volume-music', 'volume-effects', 'volume-voices', 'volume-ambient']);
    assert.deepEqual(sliders.map(([, value]) => value), ['100', '70', '80', '80', '70'], 'Sliders show the default mix');
    await game.locator('#volume-music').evaluate(input => { input.value = '40'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await game.locator('#volume-ambient').focus(); await game.keyboard.press('ArrowLeft');
    assert.deepEqual(await game.evaluate(() => [ashline.audio.volumes.music, ashline.audio.volumes.ambient, document.querySelector('#volume-music-value').value]), [.4, .65, '40%']);
    assert(await game.evaluate(() => ashline.paused && document.querySelector('#menu').open), 'Adjusting the mix keeps the menu open');
    assert(await game.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    await game.locator('.audio-mix').scrollIntoViewIfNeeded();
    await game.screenshot({ path: `${output}/audio-menu-${name}.png` });
    await game.reload(); await game.waitForFunction(() => window.ashline?.booted);
    assert.deepEqual(await game.evaluate(() => [document.querySelector('#volume-music').value, document.querySelector('#volume-ambient').value]), ['40', '65'], 'The mix persists across reloads');
    await game.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Audio checks passed: ${bank.size} lazily synthesized buffers (worker, ${bank.mainMs.toFixed(1)} ms main thread), voice caps and stealing, aggregation, ducking, panning, fog-safe placement, on-demand unit voices, ambient beds, mute, pause/resume queue, persisted mix, paused result cues with a music fade, disposal, main-thread fallback, local CC0 track decoding, and in-game combat, ambience and mix sliders. Screenshots: ${output}`);
} finally { await browser.close(); }
