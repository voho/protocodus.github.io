// Decoded one-shot effects are ready before the first flight; songs stream.
// Byte counts identify the shipped effect files: a cached or HTTP-cached copy
// of a different size is stale and is fetched again from the network.
export const SAMPLE_BYTES = Object.freeze({
  'laser-small-1': 20886, 'laser-small-2': 21604, 'laser-small-3': 22976, 'laser-small-4': 22976,
  'laser-retro-1': 20808, 'laser-retro-2': 20816, 'laser-retro-3': 22516,
  'laser-heavy-1': 48554, 'laser-heavy-2': 46346, 'laser-heavy-3': 43520,
  'enemy-shot-1': 14524, 'enemy-shot-2': 15210, 'enemy-shot-3': 15660,
  'enemy-shot-heavy-1': 17466, 'enemy-shot-heavy-2': 13172,
  'explosion-1': 74264, 'explosion-2': 83834, 'explosion-3': 76590, 'explosion-4': 83834,
  'explosion-large-1': 90996, 'explosion-large-2': 123522, 'explosion-large-3': 119760,
  'boom-1': 132344, 'boom-2': 72572,
  'debris-1': 92654,
  'impact-1': 29822, 'impact-2': 29306, 'impact-3': 44144,
  'shield-hit-1': 14014, 'shield-hit-2': 14504, 'shield-hit-3': 14050,
  'deflect-1': 22868, 'deflect-2': 16590, 'deflect-3': 15788,
  'shield-break-1': 21064, 'shield-break-2': 21588,
  'glass-break-1': 33938, 'glass-break-2': 33880,
  'weak-break-1': 35890, 'weak-break-2': 47608,
  'shield-up-1': 70604,
  'pickup-1': 29748, 'pickup-2': 26566, 'pickup-3': 28568,
  'purchase-1': 28446, 'purchase-2': 25608,
  'weapon-1': 23684, 'weapon-2': 29486,
  'power-up-1': 46854, 'power-up-2': 58374,
  'drone-1': 33106, 'drone-2': 26702,
  'extra-life-1': 86414,
  'power-down-1': 31362, 'power-down-2': 37528,
  'rescue-1': 42834,
  'bonus-1': 34242, 'bonus-2': 29518,
  'ace-1': 84192,
  'combo-1': 29692, 'combo-2': 30388,
  'alarm-1': 132344,
  'alert-1': 66194,
  'hull-alarm-1': 9260,
  'boss-open-1': 46666,
  'boss-close-1': 45508,
  'notify-1': 29114,
  'challenge-1': 97064,
  'objective-1': 47584,
  'checkpoint-1': 43298,
  'split-1': 31650,
  'dive-1': 37152,
  'tractor-charge-1': 97064,
  'tractor-1': 71300,
  'respawn-1': 21534,
  'beam-charge-1': 79424,
  'beam-1': 79424,
  'graze-1': 1836,
});
// Each cue group plays one of its numbered variants, sfx/<group>-<n>.wav.
export const SAMPLE_GROUPS = {};
for (const key of Object.keys(SAMPLE_BYTES)) (SAMPLE_GROUPS[key.replace(/-\d+$/, '')] ??= []).push(key);
// Songs stream from the server while they play, so music starts within moments
// on any connection and nothing waits for a whole file. The browser's own HTTP
// cache (revalidated on every visit) makes repeat plays cheap and never stale.
export const SONGS = {
  flight: { file: '1.mp3', gain: .245 },
  flight2: { file: '2.mp3', gain: .251 },
  flight3: { file: '3.mp3', gain: .237 },
  boss: { file: '4.mp3', gain: .235 },
  challenge: { file: '5.mp3', gain: .249 }
};
export const songUrl = key => new URL(`./assets/audio/music/${SONGS[key].file}`, import.meta.url).href;
// Bump when the shipped effects change shape; older caches are removed on open
// (including complete songs that earlier versions stored there).
export const AUDIO_CACHE = 'tyran-audio-v5';
// Launch waits at most this long for effects. Downloads still running keep
// going and each effect is used as soon as it is ready.
export const STARTUP_BUDGET = 15000;
// Effects decode at their shipped rate; playback resamples once to the device.
const SAMPLE_RATE = 44100;
const effects = Object.keys(SAMPLE_BYTES).map(key => ({ key, path: `sfx/${key}.wav`, bytes: SAMPLE_BYTES[key] }));
const progress = { ready: false, completed: 0, total: effects.length, loaded: 0, failed: 0 };
// `progress` keeps counting after launch while late downloads settle.
export const audioAssets = { samples: new Map(), ready: false, get progress() { return { ...progress }; } };
const listeners = new Set();
let pending;
const notify = () => {
  for (const callback of listeners) {
    try { callback({ ...progress }); } catch { /* Progress UI cannot interrupt loading. */ }
  }
};

async function load(asset, cache, decoder) {
  const url = new URL(`./assets/audio/${asset.path}`, import.meta.url).href;
  const download = async mode => {
    const fetched = await fetch(url, { cache: mode });
    if (!fetched.ok) throw new Error('Audio asset unavailable');
    return fetched;
  };
  const read = response => response.arrayBuffer();
  const size = body => body.byteLength;
  let response, source = 'cache';
  try { response = await cache?.match(url); } catch { /* Fall through to HTTP cache/network. */ }
  if (!response) { response = await download('force-cache'); source = 'http'; }
  let copy = response.clone(), body = await read(response);
  // A stale copy of a replaced file, from either cache, is replaced from the network.
  if (size(body) !== asset.bytes) { response = await download('reload'); source = 'network'; copy = response.clone(); body = await read(response); }
  if (source !== 'cache' && size(body) === asset.bytes) {
    try { await cache?.put(url, copy); } catch { /* The in-memory copy still works. */ }
  }
  if (!decoder) throw new Error('Offline audio decoder unavailable');
  audioAssets.samples.set(asset.key, await decoder.decodeAudioData(body));
}

export function preloadAudio(onProgress) {
  if (typeof onProgress === 'function') {
    try { onProgress({ ...progress }); } catch { /* Optional progress UI. */ }
    if (!progress.ready) listeners.add(onProgress);
  }
  if (pending) return pending;
  pending = (async () => {
    // One budget covers the whole startup wait, including storage and decode.
    let timer;
    const startup = new Promise(resolve => { timer = setTimeout(resolve, STARTUP_BUDGET); });
    const loading = (async () => {
      let decoder, cache;
      try {
        const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        decoder = new OfflineContext(1, 1, SAMPLE_RATE);
      } catch { /* Effects use the synthesizer if offline decoding is unavailable. */ }
      try {
        cache = await globalThis.caches?.open(AUDIO_CACHE);
        // Older caches hold replaced effects, and complete songs that now stream.
        for (const name of await globalThis.caches?.keys() || []) if (name.startsWith('tyran-audio-') && name !== AUDIO_CACHE) globalThis.caches.delete(name).catch(() => {});
      } catch { /* Storage is optional. */ }
      const run = (queue, workers) => Promise.all(Array.from({ length: workers }, async () => {
        while (queue.length) {
          const asset = queue.shift();
          try { await load(asset, cache, decoder); progress.loaded++; }
          catch { progress.failed++; /* A missing effect uses the synthesizer. */ }
          finally { progress.completed++; notify(); }
        }
      }));
      await run([...effects], 4);
    })();
    await Promise.race([loading, startup]);
    clearTimeout(timer);
    audioAssets.ready = progress.ready = true;
    notify(); listeners.clear();
    return { ...progress };
  })();
  return pending;
}
