// Run with: node tests/analytics-media-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../assets/js/analytics-media.js', import.meta.url), 'utf8');
function node(properties = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
    emit(type, event = {}) { for (const callback of listeners.get(type) || []) callback(event); },
  }, properties);
}
function harness({ frames = [], active = true, soundCloud = false, asyncDuration = false } = {}) {
  let clock = 0, trackIndex = 0;
  const events = [], scripts = [], widgetHandlers = new Map(), pendingDurations = [];
  const video = node({ tagName: 'VIDEO', id: 'private@email.test', currentSrc: 'https://cdn.test/demo?token=secret', duration: 100, currentTime: 0, playbackRate: 1, paused: true, ended: false, seeking: false });
  const window = node({ protocodusAnalytics: { isEnabled: () => active, track: (name, params) => events.push({ name, params }) } });
  if (soundCloud) {
    const widget = {
      bind(type, callback) { widgetHandlers.set(type, callback); },
      getDuration(callback) { if (asyncDuration) pendingDurations.push(callback); else callback(100000); },
      getCurrentSoundIndex(callback) { callback(trackIndex); },
    };
    const Widget = () => widget;
    Widget.Events = Object.fromEntries(['READY', 'PLAY', 'PLAY_PROGRESS', 'PAUSE', 'FINISH', 'SEEK', 'ERROR'].map((key) => [key, key]));
    window.SC = { Widget };
  }
  const document = {
    querySelectorAll(selector) { return selector === 'video, audio' ? [video] : frames; },
    createElement() { return node(); },
    head: { appendChild(script) { scripts.push(script); } },
  };
  const context = { window, document, location: { pathname: '/product/lamer/' }, performance: { now: () => clock }, URL, Set, Number };
  runInNewContext(source, context);
  return {
    window, video, events, scripts, context,
    tick(position, seconds = 1) { clock += seconds * 1000; video.currentTime = position; video.emit('timeupdate'); },
    advance(position, seconds = 1) { clock += seconds * 1000; video.currentTime = position; },
    enable() { active = true; window.emit('protocodus:analytics-enabled'); },
    disable() { active = false; window.emit('protocodus:analytics-enabled'); },
    widget(type, event) { widgetHandlers.get(type)?.(event); },
    soundTick(position, seconds = 1) { clock += seconds * 1000; widgetHandlers.get('PLAY_PROGRESS')?.({ currentPosition: position * 1000, title: 'never collect this', user: 'private@email.test' }); },
    trackIndex(index) { trackIndex = index; },
    flushDurations() { for (const callback of pendingDurations.splice(0)) callback(100000); },
  };
}

const native = harness();
assert.equal(native.scripts.length, 0, 'Pages without a widget make no SoundCloud request');
native.video.paused = false;
native.video.emit('playing');
native.video.emit('playing');
for (let second = 1; second <= 25; second++) native.tick(second);
assert.equal(native.events.filter(({ name }) => name === 'video_start').length, 1, 'Buffering/resuming does not duplicate starts');
assert.deepEqual(native.events.filter(({ name }) => name === 'video_progress').map(({ params }) => params.percent), [25]);

native.video.seeking = true; native.video.currentTime = 90; native.video.emit('seeking');
native.tick(90);
native.video.seeking = false; native.video.emit('seeked'); native.tick(91);
assert.deepEqual(native.events.filter(({ name }) => name === 'video_progress').map(({ params }) => params.percent), [25], 'Chapter seeks cannot count skipped material');
assert.equal(native.events.filter(({ name }) => name === 'video_seek').length, 1);
assert.equal(native.events.find(({ name }) => name === 'video_seek').params.watched_seconds, 25, 'Seek events retain coverage watched before the jump');

native.video.currentTime = 0; native.video.emit('seeking'); native.video.emit('seeked');
for (let second = 1; second <= 25; second++) native.tick(second);
assert.deepEqual(native.events.filter(({ name }) => name === 'video_progress').map(({ params }) => params.percent), [25], 'Replaying a chapter counts unique coverage only');
for (let second = 26; second <= 50; second++) native.tick(second);
assert.deepEqual(native.events.filter(({ name }) => name === 'video_progress').map(({ params }) => params.percent), [25, 50]);
native.video.emit('pause');
assert.equal(native.events.at(-1).name, 'video_pause');
assert.equal(native.events.at(-1).params.watched_seconds, 51, 'Pause carries all unique ranges, including the separately played second after a seek');
native.video.emit('playing');
native.video.currentTime = 100; native.video.ended = true; native.video.emit('ended'); native.video.emit('ended');
assert.equal(native.events.filter(({ name }) => name === 'video_complete').length, 1);
assert.equal(native.events.find(({ name }) => name === 'video_complete').params.watched_seconds, 51, 'Completion retains unique coverage without counting skipped material');
assert.equal(native.events.filter(({ name }) => name === 'video_start').length, 1);
native.video.ended = false; native.video.currentTime = 0; native.video.emit('playing');
assert.equal(native.events.filter(({ name }) => name === 'video_start').length, 2, 'A real replay starts a new session');
assert.equal(native.events.filter(({ name }) => name === 'video_start').at(-1).params.watched_seconds, 0, 'Replay resets coverage');
native.tick(1);
native.video.error = { code: 4, message: 'private media URL' }; native.video.emit('error');
assert.equal(native.events.at(-1).params.error_code, 4);
assert.equal(native.events.at(-1).params.watched_seconds, 1, 'Errors retain the current session coverage');
assert.doesNotMatch(JSON.stringify(native.events), /secret|private|cdn\.test/);
runInNewContext(source, native.context);
native.video.emit('seeked');
assert.equal(native.events.filter(({ name }) => name === 'video_seek').length, 3, 'Duplicate script includes do not bind twice');
native.window.protocodusAnalytics.track = () => { throw new Error('unavailable'); };
assert.doesNotThrow(() => native.video.emit('seeked'), 'Analytics errors never interfere with playback');

const frame = { src: 'https://w.soundcloud.com/player/?url=private-playlist' };
assert.equal(harness({ frames: [{ src: 'https://w.soundcloud.com.evil.test/player/' }] }).scripts.length, 0, 'Only real SoundCloud origins are instrumented');
const deferred = harness({ frames: [frame], active: false });
deferred.video.emit('playing');
assert.equal(deferred.events.length, 0);
assert.equal(deferred.scripts.length, 0, 'Disabled analytics does not fetch another third party');
deferred.enable();
assert.equal(deferred.scripts.length, 1);
assert.equal(deferred.scripts[0].src, 'https://w.soundcloud.com/player/api.js');
deferred.window.emit('protocodus:analytics-enabled');
assert.equal(deferred.scripts.length, 1, 'Widget API loads once');

const sound = harness({ frames: [frame], soundCloud: true });
sound.widget('READY'); sound.widget('PLAY');
for (let second = 1; second <= 25; second++) sound.soundTick(second);
assert.equal(sound.events[0].name, 'audio_start');
assert.equal(sound.events[0].params.media_duration, 100);
assert.equal(sound.events[1].name, 'audio_progress');
assert.equal(sound.events[1].params.percent, 25);
sound.widget('SEEK', { currentPosition: 90000 }); sound.soundTick(91);
assert.equal(sound.events.filter(({ name }) => name === 'audio_progress').length, 1);
assert.equal(sound.events.filter(({ name }) => name === 'audio_seek').length, 1, 'SoundCloud seeks emit a semantic seek event');
assert.equal(sound.events.find(({ name }) => name === 'audio_seek').params.current_time, 90, 'SoundCloud positions are converted from milliseconds');
assert.equal(sound.events.find(({ name }) => name === 'audio_seek').params.watched_seconds, 25);
sound.widget('PAUSE'); sound.widget('PLAY');
assert.equal(sound.events.filter(({ name }) => name === 'audio_start').length, 1);
assert.equal(sound.events.find(({ name }) => name === 'audio_pause').params.watched_seconds, 26, 'SoundCloud pause reports accumulated playback');
sound.widget('FINISH'); sound.widget('FINISH');
assert.equal(sound.events.filter(({ name }) => name === 'audio_complete').length, 1);
assert.equal(sound.events.find(({ name }) => name === 'audio_complete').params.watched_seconds, 26, 'SoundCloud completion reports accumulated playback');
sound.trackIndex(1); sound.widget('PLAY');
assert.equal(sound.events.at(-1).name, 'audio_start');
assert.equal(sound.events.at(-1).params.media_id, 'lamer-soundcloud-1-1');
assert.equal(sound.events.at(-1).params.watched_seconds, 0, 'Changing SoundCloud tracks starts fresh coverage');
assert.doesNotMatch(JSON.stringify(sound.events), /private|never collect|title|user/);

const delayed = harness({ frames: [frame], soundCloud: true, asyncDuration: true });
delayed.widget('PLAY'); delayed.disable(); delayed.flushDurations(); delayed.soundTick(1);
assert.equal(delayed.events.length, 0, 'In-flight SoundCloud callbacks cannot emit after analytics is disabled');
delayed.enable(); delayed.soundTick(2);
assert.equal(delayed.events.filter(({ name }) => name === 'audio_start').length, 1, 'Continuing playback can start tracking after re-enabling');

const pausedBeforeDuration = harness({ frames: [frame], soundCloud: true, asyncDuration: true });
pausedBeforeDuration.widget('PLAY'); pausedBeforeDuration.widget('PAUSE'); pausedBeforeDuration.flushDurations();
assert.equal(pausedBeforeDuration.events.length, 0, 'A late duration callback cannot start an already paused track');

const consent = harness();
consent.video.emit('playing');
for (let second = 1; second <= 5; second++) consent.tick(second);
consent.disable(); consent.advance(9, 4); consent.enable();
consent.tick(10); consent.tick(11); consent.video.emit('pause');
assert.equal(consent.events.at(-1).params.watched_seconds, 6, 'Re-enabling without disabled timeupdates cannot count a disabled interval');
consent.video.emit('playing'); consent.tick(12);
consent.disable(); consent.tick(13); consent.tick(14); consent.enable();
consent.tick(15); consent.tick(16); consent.video.emit('pause');
assert.equal(consent.events.at(-1).params.watched_seconds, 8, 'Disabled timeupdates preserve previous unique coverage but contribute no new playback');
consent.video.emit('emptied'); consent.video.currentTime = 0; consent.video.emit('playing');
assert.equal(consent.events.at(-1).params.watched_seconds, 0, 'Changing native sources clears prior coverage');

const soundConsent = harness({ frames: [frame], soundCloud: true });
soundConsent.widget('PLAY');
for (let second = 1; second <= 5; second++) soundConsent.soundTick(second);
soundConsent.disable(); soundConsent.soundTick(6); soundConsent.soundTick(7); soundConsent.enable();
soundConsent.soundTick(8); soundConsent.soundTick(9); soundConsent.widget('PAUSE');
assert.equal(soundConsent.events.at(-1).params.watched_seconds, 6, 'SoundCloud also excludes disabled intervals while retaining already watched coverage');

console.log('Media analytics checks passed: real playback coverage, seek/replay deduplication, native errors, SoundCloud lifecycle, disabled mode and failure isolation.');
