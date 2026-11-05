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
function harness({ frames = [], youtubeFrames = [], active = true, soundCloud = false, asyncDuration = false, youtube = false, previousReady } = {}) {
  let clock = 0, trackIndex = 0;
  const events = [], scripts = [], widgetHandlers = new Map(), pendingDurations = [];
  const timers = new Map(), players = [];
  let timerId = 0;
  const video = node({ tagName: 'VIDEO', id: 'private@email.test', currentSrc: 'https://cdn.test/demo?token=secret', duration: 100, currentTime: 0, playbackRate: 1, paused: true, ended: false, seeking: false });
  const window = node({ protocodusAnalytics: { isEnabled: () => active, track: (name, params) => events.push({ name, params }) } });
  window.setInterval = (callback) => { timers.set(++timerId, callback); return timerId; };
  window.clearInterval = (id) => timers.delete(id);
  if (previousReady) window.onYouTubeIframeAPIReady = previousReady;
  const installYouTube = () => {
    window.YT = { Player: function (frame, { events: handlers }) {
      const player = {
        frame, handlers, position: 0, duration: 100, rate: 1, state: -1,
        getCurrentTime() { return this.position; },
        getDuration() { return this.duration; },
        getPlaybackRate() { return this.rate; },
        getPlayerState() { return this.state; },
        ready() { handlers.onReady({ target: this }); },
        change(state) { this.state = state; handlers.onStateChange({ data: state, target: this }); },
        error(code) { handlers.onError({ data: code, target: this }); },
      };
      players.push(player);
      return player;
    } };
  };
  if (youtube) installYouTube();
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
    querySelectorAll(selector) {
      return selector === 'video, audio' ? [video] : selector === 'iframe.soundcloud-player' ? frames
        : selector === 'iframe.youtube-player' ? youtubeFrames : selector === 'script[src]' ? scripts : [];
    },
    createElement() { return node({ remove() { scripts.splice(scripts.indexOf(this), 1); } }); },
    head: { appendChild(script) { scripts.push(script); } },
  };
  const context = { window, document, location: { pathname: '/product/lamer/' }, performance: { now: () => clock }, URL, Set, Number };
  runInNewContext(source, context);
  return {
    window, video, events, scripts, context, players, timers,
    tick(position, seconds = 1) { clock += seconds * 1000; video.currentTime = position; video.emit('timeupdate'); },
    advance(position, seconds = 1) { clock += seconds * 1000; video.currentTime = position; },
    enable() { active = true; window.emit('protocodus:analytics-enabled'); },
    disable() { active = false; window.emit('protocodus:analytics-enabled'); },
    widget(type, event) { widgetHandlers.get(type)?.(event); },
    soundTick(position, seconds = 1) { clock += seconds * 1000; widgetHandlers.get('PLAY_PROGRESS')?.({ currentPosition: position * 1000, title: 'never collect this', user: 'private@email.test' }); },
    trackIndex(index) { trackIndex = index; },
    flushDurations() { for (const callback of pendingDurations.splice(0)) callback(100000); },
    youtubeReady() { installYouTube(); window.onYouTubeIframeAPIReady?.(); },
    youtubeTick(position, seconds = 1, index = 0) {
      clock += seconds * 1000; players[index].position = position;
      for (const callback of [...timers.values()]) callback();
    },
    hide() { window.emit('pagehide'); },
    show() { window.emit('pageshow'); },
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

const authoredSound = harness({ frames: [{ ...frame, dataset: { mediaId: 'youknow-sound-demos-v1' } }], soundCloud: true });
authoredSound.widget('PLAY');
assert.equal(authoredSound.events[0].params.media_id, 'youknow-sound-demos-v1-0', 'Authored playlist identity survives page reordering');
const invalidSoundId = harness({ frames: [{ ...frame, dataset: { mediaId: 'private@email.test' } }], soundCloud: true });
invalidSoundId.widget('PLAY');
assert.equal(invalidSoundId.events[0].params.media_id, 'lamer-soundcloud-1-0', 'Invalid authored IDs cannot leak metadata');

const youtubeFrame = { src: 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?enablejsapi=1&origin=https%3A%2F%2Fprotocodus.cz', dataset: { mediaId: 'acustra-overview' } };
for (const src of [
  'https://www.youtube-nocookie.com.evil.test/embed/M7lc1UVf-VE?enablejsapi=1',
  'https://www.youtube.com/embed/short?enablejsapi=1',
  'https://www.youtube.com/embed/M7lc1UVf-VE',
]) assert.equal(harness({ youtubeFrames: [{ src }] }).scripts.length, 0, 'Only supported API-enabled YouTube embeds are observed');

let previousReadyCalls = 0;
const pendingYoutube = harness({ youtubeFrames: [youtubeFrame], previousReady() { previousReadyCalls++; throw new Error('another API consumer failed'); } });
assert.equal(pendingYoutube.scripts.length, 1);
assert.equal(pendingYoutube.scripts[0].src, 'https://www.youtube.com/iframe_api');
pendingYoutube.enable();
assert.equal(pendingYoutube.scripts.length, 1, 'Repeated enable events do not duplicate the API request');
pendingYoutube.disable(); pendingYoutube.youtubeReady();
assert.equal(previousReadyCalls, 1, 'An existing API-ready callback is preserved');
assert.equal(pendingYoutube.players.length, 0, 'API readiness while disabled does not bind a player');
pendingYoutube.enable();
assert.equal(pendingYoutube.players.length, 1, 'Enable after API readiness binds once');
pendingYoutube.disable(); pendingYoutube.players[0].state = 1; pendingYoutube.players[0].ready();
assert.equal(pendingYoutube.timers.size, 0, 'A late player-ready callback cannot start disabled polling');
assert.equal(pendingYoutube.events.length, 0);
pendingYoutube.enable(); pendingYoutube.enable();
assert.equal(pendingYoutube.players.length, 1, 'Player binding is idempotent');
assert.equal(pendingYoutube.timers.size, 1, 'An already playing video resumes observation with one timer');
assert.equal(pendingYoutube.events.filter(event => event.name === 'video_start').length, 1);
runInNewContext(source, pendingYoutube.context);
assert.equal(pendingYoutube.players.length, 1, 'Duplicate script execution cannot bind a second observer');

const yt = harness({ youtubeFrames: [youtubeFrame], youtube: true });
const player = yt.players[0];
player.ready();
assert.equal(yt.events.length, 0, 'Displaying or cueing a video is not a view');
assert.equal(yt.timers.size, 0, 'Idle players do not poll');
player.change(1); player.change(1);
for (let second = 1; second <= 25; second++) yt.youtubeTick(second);
assert.equal(yt.events.filter(event => event.name === 'video_start').length, 1, 'Duplicate PLAYING states retain one start');
assert.deepEqual(yt.events.filter(event => event.name === 'video_progress').map(event => event.params.percent), [25]);
assert.equal(yt.events[0].params.media_id, 'acustra-overview');
assert.equal(yt.events[0].params.media_provider, 'youtube');
player.change(3);
assert.equal(yt.timers.size, 0, 'Buffering stops polling without reporting a user pause');
assert.equal(yt.events.filter(event => event.name === 'video_pause').length, 0);
player.change(1); player.rate = 2; yt.youtubeTick(26, 0.5);
assert.equal(yt.events.filter(event => event.name === 'video_seek').length, 0, 'Faster playback is not mistaken for seeking');
yt.youtubeTick(90);
assert.equal(yt.events.at(-1).name, 'video_seek');
assert.equal(yt.events.at(-1).params.watched_seconds, 26, 'Skipped footage does not contribute coverage');
assert.deepEqual(yt.events.filter(event => event.name === 'video_progress').map(event => event.params.percent), [25]);
player.change(2); player.change(2);
assert.equal(yt.events.filter(event => event.name === 'video_pause').length, 1, 'Pause callbacks are deduplicated');
assert.equal(yt.timers.size, 0);
player.position = 0; player.change(1); player.rate = 1;
for (let second = 1; second <= 25; second++) yt.youtubeTick(second);
assert.deepEqual(yt.events.filter(event => event.name === 'video_progress').map(event => event.params.percent), [25], 'Rewatching the same range cannot earn another milestone');
player.position = 100; player.change(0); player.change(0);
assert.equal(yt.events.filter(event => event.name === 'video_complete').length, 1);
assert.equal(yt.timers.size, 0, 'Ended players do not poll');
player.position = 0; player.change(1);
assert.equal(yt.events.filter(event => event.name === 'video_start').length, 2, 'A completed video can start a new replay');
assert.equal(yt.events.filter(event => event.name === 'video_start').at(-1).params.watched_seconds, 0);
yt.youtubeTick(1); player.error(153);
assert.equal(yt.events.at(-1).name, 'video_error');
assert.equal(yt.events.at(-1).params.error_code, 153);
assert.equal(yt.events.at(-1).params.watched_seconds, 1);
assert.equal(yt.timers.size, 0, 'Errored players do not keep polling');

const ytConsent = harness({ youtubeFrames: [youtubeFrame], youtube: true });
const consentPlayer = ytConsent.players[0]; consentPlayer.ready(); consentPlayer.change(1);
for (let second = 1; second <= 5; second++) ytConsent.youtubeTick(second);
ytConsent.disable();
assert.equal(ytConsent.timers.size, 0, 'Disabling analytics stops YouTube polling');
ytConsent.youtubeTick(15, 10); ytConsent.enable(); ytConsent.youtubeTick(16);
consentPlayer.change(2);
assert.equal(ytConsent.events.at(-1).params.watched_seconds, 6, 'Re-enabling preserves watched coverage and excludes the disabled interval');
consentPlayer.change(1); ytConsent.hide();
const beforeHidden = ytConsent.events.length;
ytConsent.youtubeTick(20, 4); consentPlayer.error(100); ytConsent.enable();
assert.equal(ytConsent.events.length, beforeHidden, 'Pagehide suppresses late callbacks even when the core remains enabled');
assert.equal(ytConsent.timers.size, 0, 'Enable while in the back-forward cache cannot restart polling');
ytConsent.show(); ytConsent.youtubeTick(21); consentPlayer.change(2);
assert.equal(ytConsent.events.at(-1).params.watched_seconds, 7, 'Page restore excludes time away and resumes observation');
consentPlayer.change(1); consentPlayer.getCurrentTime = () => { throw new Error('player unavailable'); };
assert.doesNotThrow(() => ytConsent.youtubeTick(22));
assert.equal(ytConsent.timers.size, 0, 'API read failures stop the observer without interrupting playback');
ytConsent.window.protocodusAnalytics.track = () => { throw new Error('collector failed'); };
assert.doesNotThrow(() => consentPlayer.error(5));

const unobservedEnd = harness({ youtubeFrames: [youtubeFrame], youtube: true });
const endedPlayer = unobservedEnd.players[0]; endedPlayer.ready(); endedPlayer.change(1); unobservedEnd.youtubeTick(1);
unobservedEnd.disable(); endedPlayer.position = 100; endedPlayer.change(0); unobservedEnd.enable();
assert.equal(unobservedEnd.events.filter(event => event.name === 'video_complete').length, 0, 'A completion while disabled is never sent on re-enable');
endedPlayer.position = 0; endedPlayer.change(1); unobservedEnd.hide(); endedPlayer.position = 100; endedPlayer.state = 0; unobservedEnd.show();
assert.equal(unobservedEnd.events.filter(event => event.name === 'video_complete').length, 0, 'A completion missed while in the back-forward cache is not invented on restore');

const retryYoutube = harness({ youtubeFrames: [youtubeFrame] });
retryYoutube.scripts[0].emit('error'); retryYoutube.enable();
assert.equal(retryYoutube.scripts.length, 1, 'A failed API request can be retried without duplicate script nodes');
retryYoutube.youtubeReady();
assert.equal(retryYoutube.players.length, 1);
assert.doesNotMatch(JSON.stringify(yt.events), /title|user|private|https:/, 'YouTube analytics sends stable IDs rather than titles or external metadata');

console.log('Media analytics checks passed: native, SoundCloud and YouTube playback coverage, seek/replay deduplication, stable IDs, API/consent races, page restore, idle cleanup and failure isolation.');
