// Keep only a short window of the soundtrack in flight. The media element still
// feeds Ashline's Web Audio mixer; MP3 bytes are appended without whole-file decoding.
const CHUNK_BYTES = 64 * 1024;
const LOW_WATER = 8, HIGH_WATER = 12, KEEP_BEHIND = 20;
const MIME = 'audio/mpeg';

export function musicSeekPoint(metadata, position) {
  const before = Math.max(0, position - 1);
  let point = metadata.points[0];
  for (const candidate of metadata.points) {
    if (candidate[0] > before) break;
    point = candidate;
  }
  return { time: point[0], offset: point[1] };
}

function supportedSource() {
  // ManagedMediaSource has the same append API, but support is still queried for
  // this exact codec. Unsupported browsers retain native lazy media playback.
  return [globalThis.MediaSource, globalThis.ManagedMediaSource]
    .find(Source => Source?.isTypeSupported?.(MIME)) || null;
}

function validMetadata(data) {
  return data && Number.isFinite(data.duration) && data.duration > 0
    && Number.isSafeInteger(data.bytes) && data.bytes > 0
    && Array.isArray(data.points) && data.points.length > 0
    && data.points[0][0] === 0 && data.points[0][1] === 0
    && data.points.every((point, i) => Array.isArray(point) && point.length === 2
      && Number.isFinite(point[0]) && point[0] >= 0 && point[0] < data.duration
      && Number.isSafeInteger(point[1]) && point[1] >= 0 && point[1] < data.bytes
      && (!i || point[0] > data.points[i - 1][0] && point[1] > data.points[i - 1][1]));
}

function bufferedAt(ranges, position) {
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= position + .05 && ranges.end(i) > position) return ranges.end(i) - position;
  }
  return 0;
}

export function createMusicStream(element, { onError = () => {} } = {}) {
  const Source = supportedSource();
  let track = null, active = false, disposed = false, mode = Source ? 'mse' : 'native';
  let source = null, buffer = null, objectURL = null, controller = null, timer = 0;
  let epoch = 0, seekVersion = 0, running = false, nextOffset = 0, pendingSeek = null, seekTarget = null;
  let resumePosition = 0, nativeRestorePending = false, bytesFetched = 0, requests = 0, failed = false, fatalFailure = false;
  // Reattaching native audio reports time zero until metadata arrives. A second
  // pause during that load must retain the saved position instead of replacing it.
  const position = () => nativeRestorePending ? resumePosition
    : Number.isFinite(element.currentTime) ? element.currentTime : resumePosition;
  const ahead = () => bufferedAt(buffer?.buffered || element.buffered, position());
  const current = (generation, version) => !disposed && epoch === generation && seekVersion === version;

  function fail(error, fatal = false) {
    if (failed || disposed) return;
    failed = true; fatalFailure = fatal || Boolean(error?.streamFatal); controller?.abort();
    onError(error instanceof Error ? error.message : String(error));
  }
  function stopTimer() { clearTimeout(timer); timer = 0; }
  function poll() {
    stopTimer();
    if (!active || disposed || failed || mode !== 'mse') return;
    if (pendingSeek !== null || ahead() < LOW_WATER) void pump();
    timer = setTimeout(poll, 250);
  }
  function detach() {
    epoch++; seekVersion++; controller?.abort(); controller = null;
    stopTimer(); source = null; buffer = null; running = false;
    element.pause(); element.removeAttribute('src'); element.load();
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
  }
  function attach() {
    if (!track || disposed || source || element.getAttribute('src')) return;
    if (mode === 'native') {
      nativeRestorePending = resumePosition > 0;
      element.preload = 'none';
      element.src = track.url;
      return;
    }
    const generation = epoch, media = new Source();
    source = media;
    element.disableRemotePlayback = true;
    objectURL = URL.createObjectURL(media);
    media.addEventListener('sourceopen', () => {
      if (disposed || epoch !== generation || source !== media) return;
      try {
        buffer = media.addSourceBuffer(MIME);
        media.duration = track.metadata.duration;
        buffer.addEventListener('error', () => {
          if (epoch === generation) fail(new Error('The soundtrack stream could not be decoded.'), true);
        });
        if (resumePosition > 0) { pendingSeek = resumePosition; element.currentTime = resumePosition; }
        poll();
      } catch (error) { fail(error, true); }
    }, { once: true });
    element.preload = 'none';
    element.src = objectURL;
  }
  function mutate(action, target = buffer) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        target.removeEventListener('updateend', finish);
        target.removeEventListener('error', error);
        target.removeEventListener('abort', aborted);
      };
      const finish = () => { cleanup(); resolve(); };
      const error = () => { cleanup(); reject(Object.assign(new Error('The soundtrack stream could not be decoded.'), { streamFatal: true })); };
      const aborted = () => { cleanup(); reject(new DOMException('Stream interrupted', 'AbortError')); };
      target.addEventListener('updateend', finish);
      target.addEventListener('error', error);
      target.addEventListener('abort', aborted);
      try { action(); } catch (failure) {
        cleanup();
        reject(Object.assign(new Error(failure.message || String(failure)), { streamFatal: true }));
      }
    });
  }
  async function resetSeek(target, generation, version) {
    const point = musicSeekPoint(track.metadata, target);
    // Setting timestampOffset reopens an ended source before abort resets its parser.
    if (source.readyState === 'ended') buffer.timestampOffset = buffer.timestampOffset;
    buffer.abort();
    if (buffer.buffered.length) {
      const end = buffer.buffered.end(buffer.buffered.length - 1);
      await mutate(() => buffer.remove(0, end));
      if (!current(generation, version)) return false;
    }
    buffer.timestampOffset = point.time;
    nextOffset = point.offset;
    return true;
  }
  async function readRange(start, end, generation, version) {
    const request = new AbortController();
    controller = request; requests++;
    try {
      const response = await fetch(track.url, {
        headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store', signal: request.signal,
      });
      const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (response.status !== 206 || !range || Number(range[1]) !== start || Number(range[2]) !== end
        || Number(range[3]) !== track.metadata.bytes) {
        await response.body?.cancel();
        throw new Error('Soundtrack streaming requires byte-range support from the server.');
      }
      if (!response.body) throw new Error('This browser cannot read the soundtrack stream.');
      const expected = end - start + 1, reader = response.body.getReader(), bytes = new Uint8Array(expected);
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesFetched += value.byteLength;
        if (length + value.byteLength > expected) {
          await reader.cancel();
          throw new Error('The soundtrack server returned an oversized audio range.');
        }
        bytes.set(value, length); length += value.byteLength;
      }
      if (length !== expected) throw new Error('The soundtrack stream ended before its audio range was complete.');
      return current(generation, version) && active ? bytes : null;
    } finally { if (controller === request) controller = null; }
  }
  async function pump() {
    if (running || !active || failed || !buffer || disposed) return;
    const generation = epoch, version = seekVersion, target = buffer;
    running = true;
    try {
      if (pendingSeek !== null) {
        const desired = pendingSeek; pendingSeek = null;
        seekTarget = desired;
        if (!await resetSeek(desired, generation, version)) return;
      }
      while (active && current(generation, version) && !failed && ahead() < HIGH_WATER) {
        if (nextOffset >= track.metadata.bytes) {
          if (source.readyState === 'open' && !target.updating) source.endOfStream();
          break;
        }
        const removeTo = position() - KEEP_BEHIND;
        if (target.buffered.length && removeTo > target.buffered.start(0) + 1) {
          await mutate(() => target.remove(0, removeTo), target);
          if (!current(generation, version) || !active) return;
        }
        const start = nextOffset, end = Math.min(start + CHUNK_BYTES, track.metadata.bytes) - 1;
        const bytes = await readRange(start, end, generation, version);
        if (!bytes || !current(generation, version)) return;
        await mutate(() => target.appendBuffer(bytes), target);
        // A pause during append keeps these completed bytes and resumes after them.
        if (!current(generation, version)) return;
        nextOffset = end + 1;
        if (ahead() > .05) seekTarget = null;
      }
    } catch (error) {
      if (current(generation, version) && error.name !== 'AbortError') fail(error);
    } finally {
      if (epoch === generation) {
        running = false;
        if (active && pendingSeek !== null && !failed) queueMicrotask(() => void pump());
      }
    }
  }
  function seek() {
    if (!track || disposed || mode !== 'mse' || !buffer) return;
    const target = position();
    if (bufferedAt(buffer.buffered, target) > .05 && pendingSeek === null && seekTarget === null) return;
    pendingSeek = Math.min(target, track.metadata.duration);
    seekVersion++; controller?.abort();
    if (active) void pump();
  }
  function restoreNativePosition() {
    if (mode !== 'native' || !track || !active || !resumePosition) return;
    try {
      element.currentTime = Math.min(resumePosition, element.duration || track.metadata.duration);
      nativeRestorePending = false;
    }
    catch { /* Some native engines wait for their first playable range. */ }
  }
  element.addEventListener('seeking', seek);
  element.addEventListener('loadedmetadata', restoreNativePosition);

  return {
    setTrack(url, metadata) {
      if (disposed) return;
      if (!validMetadata(metadata)) throw new TypeError('Soundtrack streaming metadata is invalid.');
      if (track?.url === url) return;
      detach(); track = { url, metadata }; mode = Source ? 'mse' : 'native';
      nextOffset = 0; pendingSeek = null; seekTarget = null; resumePosition = 0; nativeRestorePending = false;
      bytesFetched = 0; requests = 0; failed = false; fatalFailure = false;
      if (active) { attach(); poll(); }
    },
    setPlaying(value) {
      if (disposed) return;
      const wasActive = active;
      active = Boolean(value);
      if (active) {
        if (!wasActive && failed) {
          // A deliberate resume retries a failed range at its uncommitted offset.
          // Decoder failures need a fresh media source, then an indexed seek.
          if (fatalFailure) {
            const saved = position(); detach(); resumePosition = saved;
            nextOffset = 0; pendingSeek = null; seekTarget = null;
          }
          failed = false; fatalFailure = false;
        }
        attach(); poll();
      }
      else {
        stopTimer(); controller?.abort();
        if (mode === 'native' && element.getAttribute('src')) {
          resumePosition = position(); detach();
        }
      }
    },
    dispose() {
      if (disposed) return;
      active = false; detach(); disposed = true; track = null;
      element.removeEventListener('seeking', seek);
      element.removeEventListener('loadedmetadata', restoreNativePosition);
    },
    get status() {
      return { mode, bufferedAhead: ahead(), bytesFetched, requests,
        position: mode === 'native' && !element.getAttribute('src') ? resumePosition : position() };
    },
  };
}
