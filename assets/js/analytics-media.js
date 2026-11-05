/* Playback analytics for page demos. Game-generated audio is deliberately outside this module. */
(() => {
  'use strict';
  if (window.__protocodusMediaAnalytics) return;
  window.__protocodusMediaAnalytics = true;

  let pageActive = true;
  const enabled = () => {
    try { return pageActive && window.protocodusAnalytics?.isEnabled() === true; } catch { return false; }
  };
  const send = (name, params) => {
    try { if (enabled()) window.protocodusAnalytics.track(name, params); } catch { /* Playback remains independent. */ }
  };
  const number = (value) => Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : 0;
  const product = location.pathname.match(/^\/product\/([a-z0-9-]+)\//)?.[1] || 'demo';
  const mediaId = (element, fallback) => /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(element.dataset?.mediaId || '') ? element.dataset.mediaId : fallback;
  const sessions = [];
  // Count unique, continuously played ranges, so scrubbing or replaying a chapter
  // cannot report unwatched material as a progress milestone.
  function coverage() {
    let ranges = [], previous = null, at = 0;
    return {
      reset() { ranges = []; previous = null; },
      suspend() { previous = null; at = performance.now(); },
      jump(position) { previous = position; at = performance.now(); },
      total() { return ranges.reduce((sum, [start, end]) => sum + end - start, 0); },
      sample(position, playing, rate = 1) {
        const now = performance.now(), elapsed = (now - at) / 1000;
        const delta = previous === null ? 0 : position - previous;
        if (playing && delta > 0 && delta <= Math.min(5, elapsed * Math.max(0.1, rate) * 2 + 0.5)) {
          ranges.push([previous, position]);
          ranges.sort((a, b) => a[0] - b[0]);
          const merged = [];
          for (const range of ranges) {
            const last = merged.at(-1);
            if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
            else merged.push(range);
          }
          ranges = merged;
        }
        previous = position; at = now;
        return this.total();
      },
    };
  }
  function session(kind, provider, id) {
    const watched = coverage();
    sessions.push(watched);
    let started = false, completed = false, milestones = new Set();
    return {
      watched,
      reset() { watched.reset(); started = completed = false; milestones = new Set(); },
      params(position, duration, seconds = watched.total()) {
        return { media_provider: provider, media_id: id(), media_duration: number(duration), current_time: number(position), watched_seconds: number(seconds) };
      },
      start(position, duration) {
        if (!enabled()) return;
        if (completed) this.reset();
        watched.jump(position);
        if (!started) { started = true; send(`${kind}_start`, this.params(position, duration)); }
      },
      progress(position, duration, playing, rate) {
        if (!enabled()) { watched.suspend(); return; }
        if (!started && playing) this.start(position, duration);
        const seconds = watched.sample(position, playing, rate);
        if (!started || !(duration > 0)) return;
        for (const percent of [25, 50, 75]) {
          if (!milestones.has(percent) && seconds / duration * 100 >= percent) {
            milestones.add(percent);
            send(`${kind}_progress`, { ...this.params(position, duration, seconds), percent });
          }
        }
      },
      pause(position, duration) { if (started && !completed) send(`${kind}_pause`, this.params(position, duration)); },
      finish(position, duration, report = true) {
        if (started && !completed) { completed = true; if (report) send(`${kind}_complete`, this.params(position, duration)); }
      },
    };
  }
  // The core emits this on both enabling and disabling. Invalidate only the
  // sampling baseline, preserving previously watched ranges while excluding any
  // playback that happened while collection was disabled, even without updates.
  window.addEventListener('protocodus:analytics-enabled', () => {
    sessions.forEach((watched) => watched.suspend());
  });
  window.addEventListener('pagehide', () => {
    pageActive = false;
    sessions.forEach((watched) => watched.suspend());
  });
  window.addEventListener('pageshow', () => {
    pageActive = true;
    sessions.forEach((watched) => watched.suspend());
  });

  document.querySelectorAll('video, audio').forEach((media, index) => {
    const kind = media.tagName.toLowerCase() === 'video' ? 'video' : 'audio';
    // IDs are authored in source, never track titles, full media URLs or metadata.
    const id = mediaId(media, `${product}-${kind}-${index + 1}`);
    const state = session(kind, 'html5', () => id);
    let playing = false;
    const progress = () => state.progress(media.currentTime, media.duration, playing && !media.seeking, media.playbackRate);
    media.addEventListener('playing', () => { playing = true; state.start(media.currentTime, media.duration); });
    media.addEventListener('timeupdate', progress);
    media.addEventListener('waiting', () => { progress(); playing = false; });
    media.addEventListener('pause', () => { progress(); playing = false; if (!media.ended) state.pause(media.currentTime, media.duration); });
    media.addEventListener('ended', () => { progress(); playing = false; state.finish(media.currentTime, media.duration); });
    media.addEventListener('seeking', () => state.watched.jump(media.currentTime));
    media.addEventListener('seeked', () => {
      state.watched.jump(media.currentTime);
      send(`${kind}_seek`, state.params(media.currentTime, media.duration));
    });
    media.addEventListener('emptied', () => { playing = false; state.reset(); });
    media.addEventListener('error', () => send(`${kind}_error`, { ...state.params(media.currentTime, media.duration), error_code: number(media.error?.code) }));
    // A module can arrive after autoplay has already started.
    if (!media.paused && !media.ended) { playing = true; state.start(media.currentTime, media.duration); }
  });

  let soundCloudLoading = false;
  function bindSoundCloud() {
    if (!enabled() || soundCloudLoading) return;
    const frames = [...document.querySelectorAll('iframe.soundcloud-player')].filter((frame) => {
      try { return new URL(frame.src).origin === 'https://w.soundcloud.com'; } catch { return false; }
    });
    if (!frames.length) return;
    soundCloudLoading = true;
    const connect = () => {
      if (!window.SC?.Widget || !enabled()) { soundCloudLoading = false; return; }
      frames.forEach((frame, index) => {
        try {
          const widget = window.SC.Widget(frame), events = window.SC.Widget.Events;
          let trackIndex = null, duration = 0, position = 0, playing = false, playRequest = 0;
          const id = mediaId(frame, `${product}-soundcloud-${index + 1}`);
          const state = session('audio', 'soundcloud', () => `${id}-${trackIndex ?? 0}`);
          const updateDuration = () => widget.getDuration((milliseconds) => { duration = number(milliseconds / 1000); });
          widget.bind(events.READY, updateDuration);
          widget.bind(events.PLAY, () => {
            const request = ++playRequest;
            widget.getCurrentSoundIndex((nextIndex) => {
              if (request !== playRequest || !Number.isInteger(nextIndex)) return;
              if (trackIndex !== nextIndex) { trackIndex = nextIndex; state.reset(); position = duration = 0; }
              widget.getDuration((milliseconds) => {
                if (request !== playRequest) return;
                duration = number(milliseconds / 1000); playing = true; state.start(position, duration);
              });
            });
          });
          widget.bind(events.PLAY_PROGRESS, (event) => {
            position = number(event?.currentPosition / 1000);
            state.progress(position, duration, playing, 1);
          });
          widget.bind(events.SEEK, (event) => {
            position = number(event?.currentPosition / 1000);
            state.watched.jump(position);
            send('audio_seek', state.params(position, duration));
          });
          widget.bind(events.PAUSE, () => { ++playRequest; playing = false; state.pause(position, duration); });
          widget.bind(events.FINISH, () => { ++playRequest; playing = false; state.finish(position, duration); });
          if (events.ERROR) widget.bind(events.ERROR, () => send('audio_error', state.params(position, duration)));
        } catch { /* A blocked or unavailable external widget never affects the page. */ }
      });
    };
    if (window.SC?.Widget) connect();
    else {
      const script = document.createElement('script');
      script.src = 'https://w.soundcloud.com/player/api.js';
      script.async = true;
      script.addEventListener('load', connect, { once: true });
      script.addEventListener('error', () => { soundCloudLoading = false; }, { once: true });
      document.head.appendChild(script);
    }
  }
  bindSoundCloud();
  window.addEventListener('protocodus:analytics-enabled', bindSoundCloud);
  window.addEventListener('pageshow', bindSoundCloud);

  // Observe the official player API without controlling playback. Its state
  // events have no seek event, so timeline jumps are detected while sampling.
  const youtubePlayers = new Map();
  let youtubeLoading = false, youtubeReadyHooked = false;
  function youtubeVideoId(frame) {
    try {
      const url = new URL(frame.src);
      if (!['https://www.youtube.com', 'https://www.youtube-nocookie.com'].includes(url.origin)) return '';
      if (url.searchParams.get('enablejsapi') !== '1') return '';
      return /^\/embed\/([a-z0-9_-]{11})$/i.exec(url.pathname)?.[1] || '';
    } catch { return ''; }
  }
  function bindYouTube() {
    if (!enabled()) return;
    const frames = [...document.querySelectorAll('iframe.youtube-player')].filter(frame => youtubeVideoId(frame) && !youtubePlayers.has(frame));
    if (!frames.length) return;
    if (!window.YT?.Player) {
      if (youtubeLoading) return;
      youtubeLoading = true;
      if (!youtubeReadyHooked) {
        youtubeReadyHooked = true;
        const previous = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function (...args) {
          try { previous?.apply(this, args); } catch { /* Preserve other API users. */ }
          youtubeLoading = false;
          bindYouTube();
        };
      }
      const existing = [...document.querySelectorAll('script[src]')].some(script => script.src === 'https://www.youtube.com/iframe_api');
      if (!existing) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.addEventListener('error', () => { youtubeLoading = false; script.remove(); }, { once: true });
        document.head.appendChild(script);
      }
      return;
    }
    frames.forEach(frame => {
      const state = session('video', 'youtube', () => mediaId(frame, `${product}-youtube-${youtubeVideoId(frame)}`));
      let player, ready = false, timer = null, lastState = -1, previous = null, sampledAt = 0;
      let position = 0, duration = 0;
      const stop = () => {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
      };
      const suspend = () => { stop(); previous = null; state.watched.suspend(); };
      const read = () => {
        position = number(player.getCurrentTime());
        duration = number(player.getDuration());
        const rate = player.getPlaybackRate();
        return Number.isFinite(rate) && rate > 0 ? rate : 1;
      };
      const sample = (playing) => {
        if (!enabled()) { suspend(); return; }
        const rate = read(), now = performance.now();
        const delta = previous === null ? 0 : position - previous;
        const maximum = playing ? Math.min(5, (now - sampledAt) / 1000 * rate * 2 + 0.5) : 0.5;
        if (previous !== null && (delta < -0.5 || delta > maximum)) {
          state.watched.jump(position);
          send('video_seek', state.params(position, duration));
        } else state.progress(position, duration, playing, rate);
        previous = position; sampledAt = now;
      };
      const change = (next) => {
        if (!ready || !enabled()) {
          if (next === 0) state.finish(position, duration, false);
          lastState = next; suspend(); return;
        }
        try {
          if (next === 1) {
            if (lastState !== 1 || timer === null) {
              sample(false);
              state.start(position, duration);
            }
            if (timer === null) timer = window.setInterval(() => {
              try { sample(true); } catch { suspend(); }
            }, 500);
          } else {
            sample(lastState === 1);
            stop(); state.watched.suspend();
            if (next === 2 && lastState !== 2) state.pause(position, duration);
            if (next === 0) state.finish(position, duration);
          }
          lastState = next;
        } catch { suspend(); }
      };
      const resume = () => {
        if (!ready || !enabled()) { suspend(); return; }
        try {
          const next = player.getPlayerState();
          if (next === 1) change(next);
          else {
            // Synchronizing after API readiness, disabled collection or BFCache
            // must not invent a pause/completion that happened while unobserved.
            read(); lastState = next; suspend();
            if (next === 0) state.finish(position, duration, false);
          }
        } catch { suspend(); }
      };
      youtubePlayers.set(frame, { suspend, resume });
      try {
        player = new window.YT.Player(frame, { events: {
          onReady(event) { player = event.target; ready = true; resume(); },
          onStateChange(event) { change(event.data); },
          onError(event) {
            suspend();
            send('video_error', { ...state.params(position, duration), error_code: number(event.data) });
          },
        } });
      } catch { youtubePlayers.delete(frame); }
    });
  }
  function resumeYouTube() {
    bindYouTube();
    youtubePlayers.forEach(controller => controller.resume());
  }
  bindYouTube();
  window.addEventListener('protocodus:analytics-enabled', resumeYouTube);
  window.addEventListener('pagehide', () => { youtubePlayers.forEach(controller => controller.suspend()); });
  window.addEventListener('pageshow', resumeYouTube);
})();
