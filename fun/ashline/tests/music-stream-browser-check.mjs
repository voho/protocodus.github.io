// A real, throttled range server proves music starts from bounded chunks before a whole track downloads.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MUSIC_TRACKS} from '../audio.js';

const {chromium} = await import(process.env.ASHLINE_PLAYWRIGHT || 'playwright');
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const requests = [], active = new Set(), errors = [];
let ignoreRanges = false, audioBodyDelay = 0;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname.endsWith('/music-stream-check.html')) {
    response.writeHead(200, {'content-type': 'text/html'});
    response.end('<button id="enable">Enable audio</button>');
    return;
  }
  const file = resolve(root, `.${pathname}`);
  if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  let bytes;
  try { bytes = readFileSync(file); } catch { response.writeHead(404).end(); return; }
  const mp3 = extname(file) === '.mp3';
  if (!mp3) {
    response.writeHead(200, {'content-type': extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream'});
    response.end(bytes); return;
  }
  const range = !ignoreRanges && request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  if (start > end) { response.writeHead(416, {'content-range': `bytes */${bytes.length}`}).end(); return; }
  const entry = {file: pathname.split('/').pop(), start, end, bytes: 0, size: bytes.length, requestedRange: request.headers.range, complete: false, cancelled: false};
  requests.push(entry); active.add(entry);
  const headers = {'content-type': 'audio/mpeg', 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'no-store'};
  if (range) headers['content-range'] = `bytes ${start}-${end}/${bytes.length}`;
  response.writeHead(range ? 206 : 200, headers);
  response.flushHeaders();
  let offset = start, timer;
  const send = () => {
    if (response.destroyed) return;
    const next = Math.min(offset + 16384, end + 1);
    response.write(bytes.subarray(offset, next)); entry.bytes += next - offset; offset = next;
    if (offset > end) { entry.complete = true; response.end(); }
    else timer = setTimeout(send, 60);
  };
  response.on('close', () => {
    clearTimeout(timer); entry.cancelled = !entry.complete; active.delete(entry);
  });
  if (audioBodyDelay) timer = setTimeout(send, audioBodyDelay);
  else send();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/fun/ashline/`;
const browser = await chromium.launch({channel: process.env.ASHLINE_BROWSER || 'chrome', headless: true});
const settleTransfers = async () => {
  for (let i = 0; i < 30 && active.size; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(active.size, 0, 'Stopping music cancels every active media response');
};
const setupPage = async (native = false) => {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  if (native) await page.addInitScript(() => { window.MediaSource = undefined; window.ManagedMediaSource = undefined; });
  await page.goto(`${base}music-stream-check.html`);
  await page.evaluate(async () => {
    window.musicFetches = 0; window.mediaDecodes = 0;
    const fetch = window.fetch;
    window.fetch = (...args) => {
      if (String(args[0]).includes('/assets/audio/')) musicFetches++;
      return fetch(...args);
    };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (...args) { mediaDecodes++; return decode.apply(this, args); };
    const connect = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (element) { window.soundtrack = element; return connect.call(this, element); };
    const {createAudio} = await import('./audio.js');
    window.sound = createAudio({storage: null});
    sound.setMusicEnabled(false);
    document.querySelector('#enable').onclick = () => sound.unlock();
  });
  return page;
};
const stop = (page, mode) => page.evaluate(mode => {
  if (mode === 'pause') sound.setPaused(true);
  else if (mode === 'mute') sound.setMusicEnabled(false);
  else sound.setVolume(mode, 0);
}, mode);
const resume = (page, mode) => page.evaluate(mode => {
  if (mode === 'pause') sound.setPaused(false);
  else if (mode === 'mute') sound.setMusicEnabled(true);
  else sound.setVolume(mode, mode === 'master' ? 1 : .7);
}, mode);
try {
  const page = await setupPage();
  await page.waitForTimeout(150);
  assert.equal(requests.length, 0, 'Idle locked audio does not request music');
  await page.locator('#enable').click();
  await page.waitForFunction(() => sound.status.contextState === 'running');
  await page.waitForTimeout(150);
  assert.equal(requests.length, 0, 'Unlocking while muted does not attach or fetch a track');
  assert.equal(await page.evaluate(() => soundtrack.preload), 'none');
  await page.evaluate(() => { sound.setPaused(true); sound.setMusicEnabled(true); });
  await page.waitForTimeout(150);
  assert.equal(requests.length, 0, 'Enabling music during a pause does not fetch a track');

  await page.evaluate(() => sound.setPaused(false));
  await page.waitForFunction(() => sound.status.musicPlaying && sound.status.musicPosition > .2, null, {timeout: 15000});
  const first = await page.evaluate(() => ({track: sound.status.musicTrack, position: sound.status.musicPosition}));
  assert.equal(first.track, MUSIC_TRACKS[0]);
  assert(requests.length > 0 && requests.reduce((sum, entry) => sum + entry.bytes, 0) < requests[0].size / 3, 'Playback starts after transferring only a small part of the track');
  assert(requests.every(entry => entry.end - entry.start + 1 <= 65536), 'Every media range is bounded to 64 KiB');
  assert(requests.every(entry => entry.file === MUSIC_TRACKS[0]), 'Only the playing track is requested; later playlist tracks are not prefetched');
  assert.equal(await page.evaluate(() => sound.status.musicStream.mode), 'mse');
  assert.equal(await page.evaluate(() => mediaDecodes), 0, 'Music never decodes a full track into a Web Audio buffer');
  assert(await page.evaluate(() => sound.status.musicStream.bufferedAhead <= 16), 'Only a short look-ahead buffer is retained');
  await page.waitForFunction(() => sound.status.musicStream.bufferedAhead >= 12, null, {timeout: 15000});
  await settleTransfers();
  const filledRequests = requests.length, filledBytes = requests.reduce((sum, entry) => sum + entry.bytes, 0);
  await page.waitForTimeout(300);
  assert.equal(requests.length, filledRequests, 'Playback stops fetching once its short buffer is full');
  assert.equal(requests.reduce((sum, entry) => sum + entry.bytes, 0), filledBytes, 'Buffered playback leaves the remainder of the track on the server');
  assert(await page.evaluate(() => sound.status.musicStream.bufferedAhead <= 16), 'The completed look-ahead stays bounded');

  // Seek beyond that buffer to ensure the next pause interrupts a request already in flight.
  await page.evaluate(() => { soundtrack.currentTime = 30; });
  for (let i = 0; i < 30 && !active.size; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(active.size > 0, 'An unbuffered seek starts a bounded range request');
  const cancelledBeforePause = requests.filter(entry => entry.cancelled).length;

  for (const mode of ['pause', 'mute', 'music', 'master']) {
    const before = await page.evaluate(() => ({track: sound.status.musicTrack, position: sound.status.musicPosition}));
    await stop(page, mode);
    await page.waitForFunction(() => !sound.status.musicPlaying);
    await settleTransfers();
    if (mode === 'pause') assert(requests.filter(entry => entry.cancelled).length > cancelledBeforePause, 'Pause aborts an in-flight media chunk');
    const stopped = await page.evaluate(() => ({track: sound.status.musicTrack, position: sound.status.musicPosition}));
    assert.equal(stopped.track, before.track);
    assert(stopped.position >= before.position && stopped.position - before.position < .7, `${mode} stores the position after its short fade`);
    const count = requests.length, transferred = requests.reduce((sum, entry) => sum + entry.bytes, 0);
    await page.waitForTimeout(200);
    assert.equal(requests.length, count, `${mode} does not start a replacement request`);
    assert.equal(requests.reduce((sum, entry) => sum + entry.bytes, 0), transferred, `${mode} stops network transfer`);
    assert.equal(await page.evaluate(() => sound.status.musicPosition), stopped.position, `${mode} retains a stable paused position`);
    await resume(page, mode);
    await page.waitForFunction(position => sound.status.musicPlaying && sound.status.musicPosition > position + .1, stopped.position, {timeout: 15000});
    assert.equal(await page.evaluate(() => sound.status.musicTrack), stopped.track, `${mode} resumes the same track`);
    assert(requests.every(entry => entry.file === MUSIC_TRACKS[0]), 'Resuming does not prefetch the next track');
  }

  await page.evaluate(() => sound.dispose());
  await page.waitForFunction(() => sound.status.contextState === 'closed' && !sound.status.musicPlaying);
  await settleTransfers();
  const count = requests.length;
  await page.evaluate(() => soundtrack.dispatchEvent(new Event('ended')));
  await page.waitForTimeout(100);
  assert.equal(requests.length, count, 'Disposed music cannot restart a download');
  assert(requests.every(entry => entry.end - entry.start + 1 <= 65536), 'Resume requests also stay bounded');
  assert(requests.reduce((sum, entry) => sum + entry.bytes, 0) < requests[0].size / 2, 'The lifecycle check never downloads a complete track');
  const bounded = [...requests], appFetches = await page.evaluate(() => musicFetches);
  await page.close();

  // A server that ignores Range must not quietly trigger a full-track download.
  ignoreRanges = true;
  const rejectionStart = requests.length, rejected = await setupPage();
  await rejected.locator('#enable').click();
  await rejected.evaluate(() => sound.setMusicEnabled(true));
  await rejected.waitForFunction(() => Boolean(sound.status.musicError), null, {timeout: 15000});
  await settleTransfers();
  await rejected.waitForTimeout(200);
  const rejections = requests.slice(rejectionStart);
  assert.equal(rejections.length, 1, 'An invalid Range response does not retry through native full-track loading');
  assert(rejections[0].cancelled && rejections[0].bytes < 65536, 'An ignored Range response is cancelled before its body can load');
  assert.equal(await rejected.evaluate(() => sound.status.musicStream.bytesFetched), 0);
  assert.equal(await rejected.evaluate(() => sound.status.musicStream.mode), 'mse', 'Network errors never downgrade into unrestricted native downloads');
  ignoreRanges = false;
  const recoveryStart = requests.length;
  await rejected.evaluate(() => { sound.setMusicEnabled(false); sound.setMusicEnabled(true); });
  await rejected.waitForFunction(() => sound.status.musicPlaying && sound.status.musicPosition > .1 && !sound.status.musicError, null, {timeout: 15000});
  assert.equal(await rejected.evaluate(() => sound.status.musicStream.mode), 'mse', 'A deliberate retry recovers through bounded streaming');
  assert.equal(await rejected.evaluate(() => sound.status.musicTrack), MUSIC_TRACKS[0], 'A network retry keeps the selected track');
  const recovery = requests.slice(recoveryStart);
  assert(recovery.length > 0 && recovery.every(entry => entry.end - entry.start + 1 <= 65536), 'A corrected Range server recovers playback through bounded requests');
  await rejected.evaluate(() => sound.dispose()); await settleTransfers(); await rejected.close();

  // Browsers without MP3 MediaSource support retain lazy native playback and position-preserving stops.
  const fallbackStart = requests.length, fallback = await setupPage(true);
  await fallback.locator('#enable').click();
  await fallback.waitForTimeout(150);
  assert.equal(requests.length, fallbackStart, 'Native fallback remains idle while muted');
  await fallback.evaluate(() => sound.setMusicEnabled(true));
  await fallback.waitForFunction(() => sound.status.musicPlaying && sound.status.musicPosition > .2, null, {timeout: 15000});
  assert.equal(await fallback.evaluate(() => sound.status.musicStream.mode), 'native');
  const nativeTrack = await fallback.evaluate(() => sound.status.musicTrack);
  for (const mode of ['pause', 'mute']) {
    await stop(fallback, mode);
    await fallback.waitForFunction(() => !sound.status.musicPlaying && !soundtrack.hasAttribute('src'));
    await settleTransfers();
    const position = await fallback.evaluate(() => sound.status.musicPosition), before = requests.length;
    await fallback.waitForTimeout(150);
    assert.equal(requests.length, before, `Native ${mode} does not fetch in the background`);
    assert.equal(await fallback.evaluate(() => sound.status.musicPosition), position, `Native ${mode} retains playback position`);
    await resume(fallback, mode);
    await fallback.waitForFunction(position => sound.status.musicPlaying && sound.status.musicPosition > position + .1, position, {timeout: 15000});
    assert.equal(await fallback.evaluate(() => sound.status.musicTrack), nativeTrack, `Native ${mode} resumes the same track`);
  }
  // A second pause can arrive before a resumed native element has metadata or restored currentTime.
  await stop(fallback, 'pause');
  await fallback.waitForFunction(() => !sound.status.musicPlaying && !soundtrack.hasAttribute('src'));
  await settleTransfers();
  const retainedPosition = await fallback.evaluate(() => sound.status.musicPosition), rapidStart = requests.length;
  assert(retainedPosition > 0, 'The rapid-resume fixture starts from an existing playback position');
  audioBodyDelay = 2000;
  const rapid = await fallback.evaluate(() => {
    // Native media keeps metadata in its own cache despite no-store; make this reconnect use a fresh URL.
    const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    let reconnect = 0;
    Object.defineProperty(soundtrack, 'src', {
      configurable: true,
      get() { return src.get.call(this); },
      set(value) { const url = new URL(value); url.searchParams.set('native-resume-fixture', String(++reconnect)); src.set.call(this, url.href); },
    });
    window.nativeMetadataLoads = 0;
    soundtrack.addEventListener('loadedmetadata', () => nativeMetadataLoads++);
    sound.setPaused(false);
    const pending = {readyState: soundtrack.readyState, currentTime: soundtrack.currentTime};
    sound.setPaused(true);
    return pending;
  });
  assert.equal(rapid.readyState, 0, 'The resumed native element has no metadata yet');
  assert.equal(rapid.currentTime, 0, 'Native currentTime has reset while its stream is reattaching');
  await fallback.waitForFunction(() => !sound.status.musicPlaying && !soundtrack.hasAttribute('src'));
  await settleTransfers();
  assert.equal(await fallback.evaluate(() => nativeMetadataLoads), 0, 'The delayed response keeps metadata unavailable through the second pause');
  assert.equal(await fallback.evaluate(() => sound.status.musicPosition), retainedPosition, 'A rapid resume/pause keeps the saved position instead of replacing it with zero');
  assert.equal(await fallback.evaluate(() => sound.status.musicTrack), nativeTrack, 'A rapid resume/pause keeps the selected native track');
  const delayedNative = requests.slice(rapidStart);
  assert(delayedNative.length > 0 && delayedNative.every(entry => entry.cancelled && entry.bytes === 0), 'The rapid pause cancels delayed native transfers before audio arrives');
  audioBodyDelay = 0;
  await resume(fallback, 'pause');
  await fallback.waitForFunction(position => sound.status.musicPlaying && sound.status.musicPosition > position + .1, retainedPosition, {timeout: 15000});
  await fallback.evaluate(() => sound.dispose()); await settleTransfers(); await fallback.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed: true, bounded, appFetches, fullTrackDecodes: 0, rangeRejections: rejections, rangeRecovery: recovery, nativeRequests: requests.slice(fallbackStart)}, null, 2));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
