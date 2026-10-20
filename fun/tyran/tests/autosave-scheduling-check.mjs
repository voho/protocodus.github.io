// Serve the repository root; run with TYRAN_PLAYWRIGHT=/path/to/playwright/index.mjs.
// Controlled RAF and idle delivery exercise save scheduling without timing-sensitive FPS assertions.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.TYRAN_PLAYWRIGHT || 'playwright');
const browser = await chromium.launch({ channel: process.env.TYRAN_BROWSER || 'chrome', headless: true });
const url = process.env.TYRAN_URL || 'http://127.0.0.1:8773/fun/tyran/';
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
  const frames = new Map(), idle = new Map(), history = new Map(), saveCallbacks = new Set();
  const nativeIdle = window.requestIdleCallback.bind(window);
  const nativeCancelIdle = window.cancelIdleCallback.bind(window);
  let sequence = 0, frameTime = 1000, insideFrame = false, interceptIdle = false;
  const writes = [];
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === 'tyran-campaign') writes.push({ insideFrame, value });
    return setItem.call(this, key, value);
  };
  window.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.requestIdleCallback = (callback, options = {}) => {
    if (!interceptIdle) return nativeIdle(callback, options);
    const id = ++sequence + 1e6, job = { callback, timeout: options.timeout };
    if (options.timeout > 500) saveCallbacks.add(callback);
    idle.set(id, job); history.set(id, job);
    return id;
  };
  window.cancelIdleCallback = id => {
    if (!history.has(id)) nativeCancelIdle(id);
    idle.delete(id);
  };
  window.__saveQA = {
    writes,
    start() { interceptIdle = true; writes.length = 0; },
    pending() { return [...idle].filter(([, job]) => saveCallbacks.has(job.callback)).map(([id]) => id); },
    pump(milliseconds = 1000 / 60) {
      frameTime += milliseconds;
      const callbacks = [...frames.values()]; frames.clear();
      insideFrame = true;
      try { for (const callback of callbacks) callback(frameTime); }
      finally { insideFrame = false; }
    },
    deliver(id, remaining = 10, didTimeout = false) {
      const job = history.get(id);
      if (!job) throw Error(`Unknown idle job ${id}`);
      idle.delete(id);
      job.callback({ didTimeout, timeRemaining: () => remaining });
    },
  };
});

try {
  await page.goto(url);
  await page.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  await page.evaluate(() => {
    document.querySelector('#launch-button').click();
    tyran.state.director.hold = true;
    tyran.state.players[0].hurt = 1e6;
    __saveQA.pump();
    __saveQA.start();
    tyran.step(4.95);
    __saveQA.pump(100);
  });
  const queued = await page.evaluate(() => ({ ids: __saveQA.pending(), writes: __saveQA.writes.length, time: tyran.state.time }));
  assert.ok(queued.time >= 5, 'real RAF physics crosses the autosave interval');
  assert.equal(queued.writes, 0, 'physics frame never writes campaign storage');
  assert.equal(queued.ids.length, 1, 'one periodic save is queued');

  await page.evaluate(id => {
    tyran.step(.2);
    __saveQA.deliver(id, 2);
  }, queued.ids[0]);
  const yielded = await page.evaluate(() => ({ ids: __saveQA.pending(), writes: __saveQA.writes.length }));
  assert.equal(yielded.writes, 0, 'an idle slice without enough budget yields');
  assert.equal(yielded.ids.length, 1, 'yielding replaces the pending job without duplicates');
  assert.notEqual(yielded.ids[0], queued.ids[0]);
  const latest = await page.evaluate(id => {
    tyran.state.score = 2345; tyran.state.credits = 678;
    tyran.step(.3);
    const time = tyran.state.time;
    __saveQA.deliver(id, 12);
    const record = JSON.parse(localStorage.getItem('tyran-campaign'));
    return { time, saved: record.state, pending: __saveQA.pending().length, writes: __saveQA.writes };
  }, yielded.ids[0]);
  assert.equal(latest.saved.time, latest.time, 'idle save captures current state, not the queue-time state');
  assert.equal(latest.saved.score, 2345); assert.equal(latest.saved.credits, 678);
  assert.equal(latest.pending, 0); assert.equal(latest.writes.length, 1);
  assert.equal(latest.writes[0].insideFrame, false);
  console.log('PASS periodic saves run outside physics, coalesce and yield to short idle budgets');

  const timeout = await page.evaluate(() => {
    tyran.step(5.1);
    const [id] = __saveQA.pending(), before = __saveQA.writes.length;
    __saveQA.deliver(id, 0, true);
    return { before, after: __saveQA.writes.length, time: tyran.state.time, saved: JSON.parse(localStorage.getItem('tyran-campaign')).state.time };
  });
  assert.equal(timeout.after, timeout.before + 1, 'expired idle deadline guarantees a save');
  assert.equal(timeout.saved, timeout.time);
  console.log('PASS the idle timeout keeps periodic saves bounded');

  const paused = await page.evaluate(() => {
    tyran.step(5.1);
    const [stale] = __saveQA.pending(), before = __saveQA.writes.length;
    tyran.pause();
    const raw = localStorage.getItem('tyran-campaign');
    __saveQA.deliver(stale, 12);
    return { stale, before, after: __saveQA.writes.length, pending: __saveQA.pending().length, scene: tyran.scene, time: tyran.state.time, saved: JSON.parse(raw).state.time, unchanged: localStorage.getItem('tyran-campaign') === raw };
  });
  assert.equal(paused.scene, 'pause'); assert.equal(paused.saved, paused.time);
  assert.equal(paused.after, paused.before + 1, 'pause saves synchronously and stale idle delivery does not write again');
  assert.equal(paused.pending, 0); assert.equal(paused.unchanged, true);
  console.log('PASS pausing saves immediately and cancels deferred work');

  const practice = await page.evaluate(() => {
    tyran.pause(); tyran.step(5.1);
    const [stale] = __saveQA.pending();
    tyran.pause();
    document.querySelector('#menu-button').click();
    const raw = localStorage.getItem('tyran-campaign'), before = __saveQA.writes.length;
    document.querySelector('#sector-flight-button').click();
    tyran.state.score = 999999; tyran.step(5.1);
    __saveQA.deliver(stale, 12);
    return { scene: tyran.scene, before, after: __saveQA.writes.length, pending: __saveQA.pending().length, unchanged: localStorage.getItem('tyran-campaign') === raw };
  });
  assert.equal(practice.scene, 'playing'); assert.equal(practice.after, practice.before);
  assert.equal(practice.pending, 0); assert.equal(practice.unchanged, true, 'stale campaign callback cannot save a practice flight');

  const replacement = await page.evaluate(() => {
    tyran.pause(); document.querySelector('#menu-button').click();
    document.querySelector('#launch-button').click();
    tyran.state.director.hold = true; tyran.step(5.1);
    const [stale] = __saveQA.pending();
    tyran.launch();
    tyran.state.score = 888888;
    const raw = localStorage.getItem('tyran-campaign'), before = __saveQA.writes.length;
    __saveQA.deliver(stale, 12);
    return { before, after: __saveQA.writes.length, unchanged: localStorage.getItem('tyran-campaign') === raw };
  });
  assert.equal(replacement.after, replacement.before);
  assert.equal(replacement.unchanged, true, 'stale callback cannot overwrite the replacement campaign');
  console.log('PASS cancelled callbacks cannot overwrite practice or replacement campaigns');

  // Browsers without idle callbacks still move periodic saves to a separate task.
  const fallbackPage = await browser.newPage({ viewport: { width: 960, height: 720 } });
  fallbackPage.on('pageerror', error => errors.push(error.message));
  await fallbackPage.addInitScript(() => {
    delete window.requestIdleCallback; delete window.cancelIdleCallback;
    localStorage.clear(); localStorage.setItem('tyran-muted', 'true');
    const nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window);
    const frames = new Map(), timers = new Map(), history = new Map(), cancelled = [];
    const writes = [];
    let sequence = 0, frameTime = 1000, insideFrame = false, captureTimers = false;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'tyran-campaign') writes.push({ insideFrame });
      return setItem.call(this, key, value);
    };
    window.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
    window.cancelAnimationFrame = id => frames.delete(id);
    window.setTimeout = (callback, delay, ...args) => {
      if (!captureTimers || delay !== 0) return nativeTimeout(callback, delay, ...args);
      const id = ++sequence + 1e6, job = () => callback(...args);
      timers.set(id, job); history.set(id, job); return id;
    };
    window.clearTimeout = id => {
      if (!history.has(id)) return nativeClear(id);
      timers.delete(id); cancelled.push(id);
    };
    window.__fallbackQA = {
      writes, cancelled,
      start() { captureTimers = true; writes.length = 0; },
      pump(milliseconds = 1000 / 60) {
        frameTime += milliseconds;
        const callbacks = [...frames.values()]; frames.clear();
        insideFrame = true;
        try { for (const callback of callbacks) callback(frameTime); }
        finally { insideFrame = false; }
      },
      flush() { const jobs = [...timers.values()]; timers.clear(); for (const job of jobs) job(); },
      deliver(id) { history.get(id)(); },
    };
  });
  await fallbackPage.goto(url);
  await fallbackPage.waitForFunction(() => window.tyran && document.body.dataset.ready === 'true', null, { polling: 20 });
  const fallback = await fallbackPage.evaluate(() => {
    document.querySelector('#launch-button').click();
    tyran.state.director.hold = true; tyran.state.players[0].hurt = 1e6;
    __fallbackQA.pump(); __fallbackQA.start();
    tyran.step(4.95); __fallbackQA.pump(100);
    const inFrameWrites = __fallbackQA.writes.length;
    __fallbackQA.flush();
    const afterTimer = __fallbackQA.writes.length;
    const time = tyran.state.time, savedTime = JSON.parse(localStorage.getItem('tyran-campaign')).state.time;
    tyran.step(5.1);
    const cancellationStart = __fallbackQA.cancelled.length;
    tyran.pause();
    const cancelled = __fallbackQA.cancelled.slice(cancellationStart);
    const pausedSave = localStorage.getItem('tyran-campaign');
    const afterPause = __fallbackQA.writes.length;
    for (const id of cancelled) __fallbackQA.deliver(id);
    __fallbackQA.flush();
    return { inFrameWrites, afterTimer, time, savedTime, afterPause, cancelled: cancelled.length,
      afterStale: __fallbackQA.writes.length, insideFrame: __fallbackQA.writes.some(write => write.insideFrame),
      unchanged: localStorage.getItem('tyran-campaign') === pausedSave };
  });
  assert.equal(fallback.inFrameWrites, 0, 'timer fallback does not save in the physics frame');
  assert.equal(fallback.afterTimer, 1, 'timer delivery saves the latest run');
  assert.equal(fallback.savedTime, fallback.time);
  assert.equal(fallback.cancelled, 1, 'pause cancels the queued save timer');
  assert.equal(fallback.afterPause, 2, 'pause still saves immediately without idle callback support');
  assert.equal(fallback.afterStale, fallback.afterPause); assert.equal(fallback.unchanged, true);
  assert.equal(fallback.insideFrame, false);
  await fallbackPage.close();
  console.log('PASS timer fallback saves outside RAF and pause cancels stale timer work');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
