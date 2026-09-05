// Serve the repository root; use the same ASHLINE_URL and ASHLINE_PLAYWRIGHT settings as browser-check.mjs.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true });
const base = process.env.ASHLINE_URL || 'http://127.0.0.1:8000/fun/ashline/';
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/audio-check.html', route => route.fulfill({ contentType: 'text/html', body: '<button id="enable">Enable audio</button>' }));
  await page.goto(new URL('audio-check.html', base).href);
  await page.evaluate(async () => {
    window.generated = [];
    const original = AudioContext.prototype.createBuffer;
    AudioContext.prototype.createBuffer = function (...args) {
      const buffer = original.apply(this, args); generated.push(buffer); return buffer;
    };
    const { createAudio, SOUND_KINDS } = await import('./audio.js');
    window.sound = createAudio(); window.soundKinds = SOUND_KINDS;
    document.querySelector('#enable').onclick = async () => { await sound.unlock(); sound.play('select'); };
  });
  assert.equal(await page.evaluate(() => sound.status.contextState), 'locked', 'No audio context or playback before a gesture');
  assert.equal(await page.evaluate(() => sound.play('rifle')), false);
  await page.locator('#enable').click();
  await page.waitForFunction(() => sound.status.contextState === 'running' && sound.status.musicPlaying);
  const buffers = await page.evaluate(() => generated.map(buffer => {
    const data = buffer.getChannelData(0);
    return { duration: buffer.duration, peak: data.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0), rms: Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length), finite: data.every(Number.isFinite) };
  }));
  const soundCount = await page.evaluate(() => soundKinds.length);
  assert.equal(buffers.length, soundCount, 'Every requested sound has a generated buffer');
  assert(buffers.every(buffer => buffer.finite && buffer.peak > .03 && buffer.peak < 1 && buffer.rms > .001), 'Generated effects are audible, finite, and do not clip');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => soundKinds.filter(kind => sound.play(kind)).length), soundCount, 'All distinct effects play');
  assert.equal(await page.evaluate(() => sound.play('artillery')), false, 'Repeated combat effects are rate limited');
  await page.evaluate(() => sound.setSfxEnabled(false));
  assert.equal(await page.evaluate(() => sound.status.activeVoices), 0, 'Muting immediately stops all effects');
  assert.equal(await page.evaluate(() => sound.play('order')), false);
  assert.equal(await page.evaluate(() => sound.status.musicPlaying), true, 'Music and SFX controls are independent');
  await page.evaluate(() => sound.setPaused(true));
  await page.waitForFunction(() => sound.status.contextState === 'suspended' && !sound.status.musicPlaying);
  await page.evaluate(() => { sound.setSfxEnabled(true); sound.setPaused(false); });
  await page.waitForFunction(() => sound.status.contextState === 'running' && sound.status.musicPlaying);
  await page.evaluate(() => sound.setMusicEnabled(false));
  assert.equal(await page.evaluate(() => sound.status.musicPlaying), false);
  assert.equal(await page.evaluate(() => sound.play('order')), true, 'Effects continue when music is muted');
  const track = await page.evaluate(async () => {
    const response = await fetch('./assets/audio/space-adventure.mp3');
    const bytes = await response.arrayBuffer(), size = bytes.byteLength, context = new AudioContext();
    const decoded = await context.decodeAudioData(bytes); await context.close();
    return { ok: response.ok, bytes: size, duration: decoded.duration, channels: decoded.numberOfChannels };
  });
  assert(track.ok && track.bytes === 5214163 && track.duration > 120 && track.duration < 140 && track.channels === 2, 'Local CC0 music decodes as the complete stereo track');
  assert.equal(await page.evaluate(() => sound.status.musicError), '');
  await page.evaluate(() => sound.setMusicEnabled(true));
  for (const kind of ['victory', 'defeat']) {
    assert.equal(await page.evaluate(kind => { if (kind === 'victory') sound.setPaused(true); return sound.play(kind); }, kind), true, `${kind} plays while its result menu is paused`);
    await page.waitForFunction(() => sound.status.contextState === 'running' && sound.status.activeVoices > 0);
    assert.equal(await page.evaluate(() => sound.status.musicPlaying), false, 'A result cue does not restart the soundtrack');
    assert.equal(await page.evaluate(() => sound.play('rifle')), false, 'Battle sounds remain suppressed behind the result menu');
    await page.waitForFunction(() => sound.status.contextState === 'suspended' && sound.status.activeVoices === 0);
  }
  await page.evaluate(() => sound.dispose());
  await page.waitForFunction(() => sound.status.contextState === 'closed' && !sound.status.musicPlaying);
  assert.equal(await page.evaluate(() => sound.unlock()), false, 'Disposed audio does not restart');
  assert.deepEqual(errors, []);
  console.log(`Audio checks passed: ${soundCount} generated effects, bounded levels, gesture unlock, rate limit, independent mute, pause/resume, paused result cues, disposal, and local CC0 track decoding.`);
} finally { await browser.close(); }
