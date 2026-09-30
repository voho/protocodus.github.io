// Keep encoded songs and decoded one-shot effects ready before the first flight.
// Songs remain compressed; complete tracks are cached without decoding them all into PCM.
export const SAMPLE_GROUPS = Object.fromEntries(['laser-small', 'laser-retro', 'laser-heavy', 'explosion', 'impact', 'pickup'].map(group =>
  [group, [1, 2, 3].map(index => `${group}-${index}`)]));
// Byte counts identify the shipped files: a cached or HTTP-cached copy of a
// different size is a stale soundtrack and is fetched again from the network.
export const SONGS = {
  flight: { file: '1.mp3', gain: .245, bytes: 4843073 },
  flight2: { file: '2.mp3', gain: .251, bytes: 4740751 },
  flight3: { file: '3.mp3', gain: .237, bytes: 4683897 },
  boss: { file: '4.mp3', gain: .235, bytes: 4682716 },
  challenge: { file: '5.mp3', gain: .249, bytes: 4509453 }
};
export const SAMPLE_BYTES = Object.freeze({
  'laser-small-1': 10500, 'laser-small-2': 10858, 'laser-small-3': 15260, 'laser-retro-1': 10460, 'laser-retro-2': 10464, 'laser-retro-3': 11326,
  'laser-heavy-1': 29918, 'laser-heavy-2': 31874, 'laser-heavy-3': 32870, 'explosion-1': 34364, 'explosion-2': 59912, 'explosion-3': 55458,
  'impact-1': 28078, 'impact-2': 30400, 'impact-3': 20854, 'pickup-1': 20622, 'pickup-2': 22990, 'pickup-3': 24142,
});
// Bump when the shipped audio changes shape; older caches are removed on open.
export const AUDIO_CACHE = 'tyran-audio-v3';
export const audioAssets = { samples: new Map(), songs: new Map(), players: new Map(), ready: false };

const assets = [
  ...Object.values(SAMPLE_GROUPS).flat().map(key => ({ key, path: `sfx/${key}.wav`, sample: true, bytes: SAMPLE_BYTES[key] })),
  ...Object.entries(SONGS).map(([key, song]) => ({ key, path: `music/${song.file}`, sample: false, bytes: song.bytes }))
];
const progress = { ready: false, completed: 0, total: assets.length, loaded: 0, failed: 0 };
const listeners = new Set();
let pending;
const notify = () => {
  for (const callback of listeners) {
    try { callback({ ...progress }); } catch { /* Progress UI cannot interrupt loading. */ }
  }
};

function prepareSong(url, signal) {
  const player = new Audio();
  return new Promise((resolve, reject) => {
    let settled = false;
    const readyEvents = ['canplaythrough', 'loadeddata', 'durationchange', 'progress', 'suspend'];
    const finish = error => {
      if (settled) return;
      settled = true;
      for (const event of readyEvents) player.removeEventListener(event, playable);
      player.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      if (error) {
        // Abort stalled media work before opening the arena. Late browser events
        // cannot publish a timed-out player or leave its Blob URL alive.
        try { player.pause(); player.removeAttribute('src'); player.load(); } catch { /* Still settle the shared deadline. */ }
        reject(error);
      } else resolve(player);
    };
    const playable = () => {
      const buffered = player.buffered;
      // The complete file is already in the Blob. Require playback readiness
      // and local availability; browsers may retain internal Blob readers and
      // decode compressed music as it plays (allow one MP3 frame of rounding).
      if (player.readyState >= 4 && player.networkState === 1 && Number.isFinite(player.duration) && player.duration > 0
        && buffered.length && buffered.start(0) <= .05 && buffered.end(buffered.length - 1) >= player.duration - .05) finish();
    };
    const failed = () => finish(new Error('Song playback unavailable'));
    const aborted = () => finish(new Error('Audio preflight timed out'));
    if (signal.aborted) { aborted(); return; }
    for (const event of readyEvents) player.addEventListener(event, playable);
    player.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    try {
      player.preload = 'auto'; player.loop = true; player.src = url; player.load();
      playable();
    } catch (error) { finish(error); }
  });
}

export function preloadAudio(onProgress) {
  if (typeof onProgress === 'function') {
    try { onProgress({ ...progress }); } catch { /* Optional progress UI. */ }
    if (!progress.ready) listeners.add(onProgress);
  }
  if (pending) return pending;
  pending = (async () => {
    // One budget covers the whole queue, including storage and decode. A slow
    // connection cannot multiply a per-file timeout across six worker batches.
    const controller = new AbortController(), signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), 15000);
    const wait = promise => new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Audio preflight timed out'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    let decoder, cache;
    try {
      const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      decoder = new OfflineContext(1, 1, 22050);
    } catch { /* SFX will use the synthesizer if offline decoding is unavailable. */ }
    try {
      cache = await wait(globalThis.caches?.open(AUDIO_CACHE));
      // Earlier versions cached by URL alone, so a replaced soundtrack kept playing.
      for (const name of await wait(globalThis.caches?.keys()) || []) if (name.startsWith('tyran-audio-') && name !== AUDIO_CACHE) globalThis.caches.delete(name).catch(() => {});
    } catch { /* Storage is optional. */ }
    const queue = [...assets];
    const worker = async () => {
      while (queue.length) {
        const asset = queue.shift(), url = new URL(`./assets/audio/${asset.path}`, import.meta.url).href;
        try {
          if (signal.aborted) throw new Error('Audio preflight timed out');
          const download = async mode => {
            if (signal.aborted) throw new Error('Audio preflight timed out');
            const fetched = await wait(fetch(url, { signal, cache: mode }));
            if (!fetched.ok) throw new Error('Audio asset unavailable');
            return fetched;
          };
          const read = async response => asset.sample ? wait(response.arrayBuffer()) : wait(response.blob());
          const size = body => body.size ?? body.byteLength;
          let response, source = 'cache';
          try { response = await wait(cache?.match(url)); } catch { /* Fall through to HTTP cache/network. */ }
          if (!response) { response = await download('force-cache'); source = 'http'; }
          let copy = response.clone(), body = await read(response);
          // A stale copy of a replaced file, from either cache, is replaced from the network.
          if (asset.bytes && size(body) !== asset.bytes) { response = await download('reload'); source = 'network'; copy = response.clone(); body = await read(response); }
          if (source !== 'cache' && (!asset.bytes || size(body) === asset.bytes)) {
            // Finish persistent cache writes during preflight too, never mid-flight.
            try { await wait(cache?.put(url, copy)); } catch { /* The in-memory copy still works. */ }
          }
          if (asset.sample) {
            if (!decoder) throw new Error('Offline audio decoder unavailable');
            audioAssets.samples.set(asset.key, await wait(decoder.decodeAudioData(body)));
          } else {
            const blob = body;
            if (!blob.size) throw new Error('Empty song');
            const songUrl = URL.createObjectURL(blob);
            try {
              const player = await prepareSong(songUrl, signal);
              audioAssets.songs.set(asset.key, songUrl);
              audioAssets.players.set(asset.key, player);
            } catch (error) { URL.revokeObjectURL(songUrl); throw error; }
          }
          progress.loaded++;
        } catch { progress.failed++; /* This session permanently uses the synth for failed assets. */ }
        finally { progress.completed++; notify(); }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    clearTimeout(timeout);
    audioAssets.ready = progress.ready = true;
    notify(); listeners.clear();
    return { ...progress };
  })();
  return pending;
}
