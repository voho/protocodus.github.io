// Bonus results retain their music, then fade the entire view and mix before the shop.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const output = process.env.TYRAN_BONUS_OUTRO_OUTPUT || '/tmp/tyran-bonus-outro-qa';
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], requests = [];
let ready = false;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => { if (ready && /^(https?:|blob:)/.test(request.url())) requests.push(request.url()); });
await mkdir(output, { recursive: true });

try {
  await page.addInitScript(() => {
    localStorage.clear(); localStorage.setItem('tyran-muted', 'false');
    const frames = new Map(); let id = 0, time = 1000;
    window.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
    window.cancelAnimationFrame = key => frames.delete(key);
    window.__frame = (milliseconds = 1000 / 60) => {
      time += milliseconds;
      const queue = [...frames.values()]; frames.clear();
      for (const callback of queue) callback(time);
    };
    window.__frames = count => { for (let i = 0; i < count; i++) __frame(); };
  });
  await page.goto(process.env.TYRAN_URL || 'http://127.0.0.1:8774/fun/tyran/');
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  await page.evaluate(async () => {
    const { AudioEngine } = await import('./audio.js');
    const { readCampaign } = await import('./save-game.js');
    const { hurtPlayer } = await import('./sim.js');
    const update = AudioEngine.prototype.update;
    window.__audioHistory = [];
    AudioEngine.prototype.update = function (...args) {
      window.__audio = this;
      const result = update.apply(this, args);
      __audioHistory.push({ scene: tyran.scene, song: this.songKey, gain: this.transitionGain });
      return result;
    };
    window.__saved = () => readCampaign();
    window.__hurtPlayer = hurtPlayer;
    window.__snapshot = () => {
      const overlay = document.querySelector('#bonus-outro-fade'), rect = overlay.getBoundingClientRect();
      return {
        scene: tyran.scene, status: tyran.state?.status, time: tyran.state?.time, scroll: tyran.state?.scroll,
        resultAge: tyran.state?.challenge ? tyran.state.time - tyran.state.challenge.result : null,
        announcement: !document.querySelector('#announcement').hidden,
        announcementText: document.querySelector('#announcement').textContent,
        overlay: !overlay.hidden, opacity: Number(overlay.style.opacity || 0),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        hangar: !document.querySelector('#hangar-screen').hidden,
        endPanel: !document.querySelector('#end-screen').hidden,
        canvasOpacity: Number(document.querySelector('#game-canvas').style.opacity || 1),
        gain: __audio?.transitionGain, busGain: __audio?.transitionBus?.gain.value,
        song: __audio?.songKey, musicPlaying: __audio?.musicPlaying,
        musicPaused: [...(__audio?.musicPlayers.values() || [])].every(player => player.paused),
        sampleVoices: __audio?.sampleVoices.size, synthVoices: __audio?.synthVoices.size,
        level: tyran.state?.level, credits: tyran.state?.credits, score: tyran.state?.score,
      };
    };
    // Run the normal guardian-to-challenge and challenge-result branches, keeping
    // combat out of a test about the presentation of already-earned rewards.
    window.__startChallenge = () => {
      const state = tyran.state;
      state.enemies.length = 0; state.bullets.length = 0; state.bossSpawned = true;
      state.bossDefeated = true; state.bossDeathTime = state.time - 4;
      state.director.hold = true;
      for (const pilot of state.players) pilot.hurt = 10000;
      tyran.step(1 / 60); __frame(0);
      if (!state.challenge || state.challenge.done) throw new Error('Normal challenge start did not run');
    };
    window.__finishChallenge = () => {
      tyran.state.challenge.clock = 2.01; tyran.state.challenge.hits = tyran.state.challenge.total;
      for (const enemy of tyran.state.enemies) enemy.gone = true;
      tyran.step(1 / 60); __frame(0);
      return __snapshot();
    };
    window.__toBlack = () => {
      let count = 0;
      while (tyran.scene === 'bonus-outro' && Number(document.querySelector('#bonus-outro-fade').style.opacity) < 1 && count < 100) { __frame(); count++; }
      return { ...__snapshot(), frames: count };
    };
    __frame(0);
  });
  ready = true;
  await context.setOffline(true);
  await page.locator('#launch-button').click();
  await page.evaluate(() => { __frame(0); __startChallenge(); });
  await page.waitForFunction(() => __audio.songKey === 'challenge' && __audio.musicPlaying, null, { polling: 20 });

  const result = await page.evaluate(() => { __audioHistory.length = 0; return __finishChallenge(); });
  assert.equal(result.scene, 'playing'); assert.equal(result.resultAge, 0);
  assert.equal(result.overlay, false); assert.equal(result.announcement, true);
  assert.match(result.announcementText, /Perfect!.*40\s*\/\s*40/s);
  assert.equal(result.song, 'challenge'); assert.equal(result.gain, 1);

  const hold = await page.evaluate(() => {
    __frames(60); const before = __snapshot(); tyran.pause(); __frame(0); __frames(60);
    const paused = __snapshot(); tyran.pause(); __frame(0); __frames(94);
    const beforeDeadline = __snapshot();
    for (let i = 0; i < 5 && tyran.scene === 'playing'; i++) __frame();
    return { before, paused, beforeDeadline, start: __snapshot(), saved: __saved().run?.scene };
  });
  assert.equal(hold.paused.scene, 'pause'); assert.equal(hold.paused.time, hold.before.time);
  assert.equal(hold.paused.scroll, hold.before.scroll, 'Pause freezes the result hold and terrain');
  assert.equal(hold.beforeDeadline.scene, 'playing'); assert.equal(hold.beforeDeadline.announcement, true);
  assert(hold.beforeDeadline.resultAge > 2.5 && hold.beforeDeadline.resultAge < 2.6);
  assert.equal(hold.start.scene, 'bonus-outro'); assert.equal(hold.start.status, 'hangar');
  assert(hold.start.resultAge > 2.6 && hold.start.resultAge < 2.64, 'Results run for their existing 2.6 seconds');
  assert.equal(hold.start.hangar, false); assert.equal(hold.start.overlay, true);
  assert(hold.start.opacity < .002); assert.equal(hold.saved, 'hangar', 'Closing during the fade preserves settled rewards in the shop');
  const savedDuringFade = await page.evaluate(() => localStorage.getItem('tyran-campaign'));

  const middle = await page.evaluate(() => {
    __frames(44);
    // A long effect remains on the shared mix until the fade endpoint.
    __audio.tone(220, 220, 3, .12);
    const before = __snapshot(); tyran.pause(); tyran.step(1);
    return { before, afterInput: __snapshot() };
  });
  assert.equal(middle.before.scene, 'bonus-outro'); assert.equal(middle.before.hangar, false);
  assert(Math.abs(middle.before.opacity - .5) < .025, 'Half of the 1.5-second fade reaches approximately half black');
  assert(Math.abs(middle.before.gain + middle.before.opacity - 1) < .0001);
  assert.equal(middle.before.time, hold.start.time); assert.equal(middle.before.scroll, hold.start.scroll);
  assert.equal(middle.afterInput.time, middle.before.time); assert.equal(middle.afterInput.scene, 'bonus-outro');
  assert(middle.before.synthVoices > 0, 'The fade applies to a still-live sound effect as well as music');
  await page.waitForTimeout(30);
  const settledGain = await page.evaluate(() => __audio.transitionBus.gain.value);
  assert(Math.abs(settledGain - middle.before.gain) < .005, 'The actual final audio bus follows the visual fade');
  await page.screenshot({ path: `${output}/desktop-mid-fade.png` });

  const visibility = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange')); __frame(5000); const hidden = __snapshot();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange')); __frame(5000); const restored = __snapshot();
    __frame(5000); const skipped = __snapshot();
    return { hidden, restored, skipped };
  });
  assert.equal(visibility.hidden.opacity, middle.before.opacity); assert.equal(visibility.hidden.musicPaused, true);
  assert.equal(visibility.restored.opacity, middle.before.opacity, 'Hidden time does not jump past the fade');
  assert.equal(visibility.restored.gain, middle.before.gain);
  assert.equal(visibility.skipped.scene, 'bonus-outro'); assert.equal(visibility.skipped.hangar, false);
  assert(visibility.skipped.opacity > middle.before.opacity && visibility.skipped.opacity < .7, 'A skipped frame advances by at most the normal 100ms cap');
  await page.waitForFunction(() => __audio.musicPlaying, null, { polling: 20 });
  const black = await page.evaluate(() => __toBlack());
  assert.equal(black.scene, 'bonus-outro'); assert.equal(black.opacity, 1); assert.equal(black.hangar, false);
  assert.equal(black.gain, 0); assert.equal(black.musicPaused, true);
  assert.equal(black.sampleVoices, 0); assert.equal(black.synthVoices, 0);
  assert.equal(black.time, hold.start.time); assert.equal(black.scroll, hold.start.scroll);
  assert(black.frames >= 38 && black.frames <= 41, 'The remaining fade duration stays near 650ms');
  const blackScreenshot = await page.screenshot({ path: `${output}/desktop-black.png` });
  const pixelResult = await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let max = 0, minAlpha = 255;
    for (let i = 0; i < pixels.length; i += 4) { max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2]); minAlpha = Math.min(minAlpha, pixels[i + 3]); }
    return { max, minAlpha, width: canvas.width, height: canvas.height };
  }, blackScreenshot.toString('base64'));
  assert.deepEqual(pixelResult, { max: 0, minAlpha: 255, width: 1280, height: 720 }, 'Every viewport pixel, including instruments and touch controls, is opaque black');
  const finished = await page.evaluate(() => {
    __frames(6); const heldBlack = __snapshot(); __frames(3); const hangar = __snapshot();
    return { heldBlack, hangar, history: __audioHistory, focus: document.activeElement.id };
  });
  assert.equal(finished.heldBlack.scene, 'bonus-outro'); assert.equal(finished.heldBlack.opacity, 1);
  assert.equal(finished.hangar.scene, 'hangar'); assert.equal(finished.hangar.hangar, true);
  assert.equal(finished.hangar.overlay, false); assert.equal(finished.hangar.gain, 1); assert.equal(finished.hangar.musicPaused, true);
  assert.equal(finished.focus, 'next-button');
  assert(finished.history.every(frame => frame.song === 'challenge'), 'Challenge music never swaps to a flight song during results, fade or shop entry');
  const fadeGains = finished.history.filter(frame => frame.scene === 'bonus-outro').map(frame => frame.gain);
  assert(fadeGains.every((gain, index) => index === 0 || gain <= fadeGains[index - 1]), 'The complete fade is monotonic');

  // Restore the exact save written at fade start, through the real Continue flow.
  await page.locator('#hangar-menu-button').click();
  await page.evaluate(raw => localStorage.setItem('tyran-campaign', raw), savedDuringFade);
  await page.locator('#continue-button').click();
  const restoredHangar = await page.evaluate(() => { __frame(0); __audio.effect('upgrade'); return __snapshot(); });
  assert.equal(restoredHangar.scene, 'hangar'); assert.equal(restoredHangar.overlay, false); assert.equal(restoredHangar.gain, 1);
  assert.equal(restoredHangar.credits, hold.start.credits); assert.equal(restoredHangar.score, hold.start.score);
  assert(restoredHangar.sampleVoices + restoredHangar.synthVoices > 0, 'A directly restored shop can play its purchase cue');
  await page.locator('#next-button').click();
  await page.evaluate(() => __frame(0));
  await page.waitForFunction(() => __audio.musicPlaying && __audio.songKey === 'flight2', null, { polling: 20 });
  const next = await page.evaluate(() => __snapshot());
  assert.equal(next.scene, 'playing'); assert.equal(next.level, 1); assert.equal(next.gain, 1); assert.equal(next.overlay, false);

  const ordinary = await page.evaluate(() => {
    const state = tyran.state;
    state.enemies.length = 0; state.bossSpawned = true; state.bossDefeated = true; state.bossDeathTime = state.time - 4;
    tyran.step(1 / 60); __frame(0); return __snapshot();
  });
  assert.equal(ordinary.scene, 'hangar'); assert.equal(ordinary.overlay, false, 'Sectors without a bonus stage keep the existing direct shop transition');
  assert.equal(ordinary.gain, 1);

  const defeat = await page.evaluate(() => {
    tyran.launch(1); __frame(0); const state = tyran.state, pilot = state.players[0];
    state.director.hold = true; state.lives = 0; pilot.hull = 1; pilot.shield = 0; pilot.guard = 0; pilot.hurt = 0;
    __hurtPlayer(state, pilot, 1000); tyran.step(1 / 60); __frame(0); const initial = __snapshot();
    __frames(48); const middle = __snapshot(); __frames(70); const complete = __snapshot();
    document.querySelector('#retry-button').click(); __frame(0); return { initial, middle, complete, retry: __snapshot() };
  });
  assert.equal(defeat.initial.scene, 'end'); assert.equal(defeat.initial.endPanel, false); assert.equal(defeat.initial.overlay, false);
  assert(defeat.middle.canvasOpacity > 0 && defeat.middle.canvasOpacity < 1); assert.equal(defeat.middle.endPanel, false);
  assert.equal(defeat.complete.canvasOpacity, 0); assert.equal(defeat.complete.endPanel, true);
  assert.equal(defeat.retry.scene, 'playing'); assert.equal(defeat.retry.canvasOpacity, 1); assert.equal(defeat.retry.gain, 1);

  // Reduced motion retains the gentle transition, including a portrait touch dock.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => tyran.fx.reduced, null, { polling: 20 });
  const mobile = await page.evaluate(() => {
    tyran.launch(0); __frame(0); __startChallenge(); __finishChallenge();
    for (let i = 0; i < 165 && tyran.scene === 'playing'; i++) __frame();
    __frames(44); const middle = __snapshot(), black = __toBlack();
    return { middle, black };
  });
  assert.equal(mobile.middle.scene, 'bonus-outro'); assert(mobile.middle.opacity > .4 && mobile.middle.opacity < .6);
  assert.deepEqual(mobile.black.rect, { x: 0, y: 0, width: 320, height: 568 });
  assert.equal(mobile.black.opacity, 1); assert.equal(mobile.black.gain, 0); assert.equal(mobile.black.hangar, false);
  await page.screenshot({ path: `${output}/mobile-black.png` });
  await page.evaluate(() => __frames(9));
  assert.equal(await page.evaluate(() => tyran.scene), 'hangar');
  assert.deepEqual(requests, [], 'Results, outro, shop, restored shop and next flight issue no late HTTP or Blob requests');
  assert.deepEqual(errors, []);
  const report = { result, hold, middle, visibility, black, pixelResult, hangar: finished.hangar, restoredHangar, next, ordinary, defeat, mobile };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  console.log('PASS bonus results 2.6s + full-view/audio fade 1.5s, black-before-shop, challenge soundtrack continuity, pause/visibility/skip safety, saved shop/next-flight recovery, nonbonus and defeat transitions, reduced-motion mobile and offline cache.');
} finally {
  await context.close(); await browser.close();
}
