// Keep encoded songs and decoded one-shot effects ready before the first flight.
// Songs remain compressed; complete tracks are cached without decoding them all into PCM.
// Byte counts identify the shipped files: a cached or HTTP-cached copy of a
// different size is stale and is fetched again from the network.
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
// Songs download one at a time in the order a campaign first needs them, so a
// slow connection gets the opening flight track as early as possible.
export const SONGS = {
  flight: { file: '1.mp3', gain: .245, bytes: 4843073 },
  boss: { file: '4.mp3', gain: .235, bytes: 4682716 },
  challenge: { file: '5.mp3', gain: .249, bytes: 4509453 },
  flight2: { file: '2.mp3', gain: .251, bytes: 4740751 },
  flight3: { file: '3.mp3', gain: .237, bytes: 4683897 }
};
// Bump when the shipped audio changes shape; older caches are removed on open.
export const AUDIO_CACHE = 'tyran-audio-v4';
// Launch waits at most this long. Downloads still running at the deadline keep
// going and each file is used as soon as it is ready, so a slow connection
// still gets the soundtrack (and caches it for the next visit) instead of
// giving up on it for the whole session.
export const STARTUP_BUDGET = 15000;
// A complete in-memory song that a browser cannot prepare by then is released.
const SONG_PREPARE_LIMIT = 20000;
// Effects decode at their shipped rate; playback resamples once to the device.
const SAMPLE_RATE = 44100;
const effects = Object.keys(SAMPLE_BYTES).map(key => ({ key, path: `sfx/${key}.wav`, sample: true, bytes: SAMPLE_BYTES[key] }));
const songs = Object.entries(SONGS).map(([key, song]) => ({ key, path: `music/${song.file}`, sample: false, bytes: song.bytes }));
const progress = { ready: false, completed: 0, total: effects.length + songs.length, loaded: 0, failed: 0 };
// `progress` keeps counting after launch while late downloads settle.
export const audioAssets = { samples: new Map(), songs: new Map(), players: new Map(), ready: false, get progress() { return { ...progress }; } };
const listeners = new Set();
let pending;
const notify = () => {
  for (const callback of listeners) {
    try { callback({ ...progress }); } catch { /* Progress UI cannot interrupt loading. */ }
  }
};

function prepareSong(url) {
  const player = new Audio();
  return new Promise((resolve, reject) => {
    let settled = false, suspended = false, grace;
    const readyEvents = ['canplaythrough', 'loadedmetadata', 'loadeddata', 'durationchange', 'progress', 'suspend'];
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(limit); clearTimeout(grace);
      for (const event of readyEvents) player.removeEventListener(event, playable);
      player.removeEventListener('error', failed);
      if (error) {
        // A late browser event cannot publish an abandoned player or keep its Blob alive.
        try { player.pause(); player.removeAttribute('src'); player.load(); } catch { /* Still settle. */ }
        reject(error);
      } else resolve(player);
    };
    const playable = event => {
      if (event?.type === 'suspend') suspended = true;
      const buffered = player.buffered;
      // Normally wait until the whole Blob is buffered, so playback reads no
      // more of it (allow one MP3 frame of rounding).
      if (player.readyState >= 4 && player.networkState === 1 && Number.isFinite(player.duration) && player.duration > 0
        && buffered.length && buffered.start(0) <= .05 && buffered.end(buffered.length - 1) >= player.duration - .05) finish();
      // iOS ignores preload and stops after the metadata until playback starts.
      else if (suspended && player.readyState >= 1 && player.readyState < 4 && player.networkState === 1) finish();
      // Some browsers never report a buffered range that reaches the duration;
      // the file is local, so playable data is enough after a short wait.
      else if (player.readyState >= 3 && !grace) grace = setTimeout(() => finish(), 3000);
    };
    const failed = () => finish(new Error('Song playback unavailable'));
    const limit = setTimeout(() => finish(new Error('Song preparation timed out')), SONG_PREPARE_LIMIT);
    for (const event of readyEvents) player.addEventListener(event, playable);
    player.addEventListener('error', failed);
    try {
      player.preload = 'auto'; player.loop = true; player.src = url; player.load();
      playable();
    } catch (error) { finish(error); }
  });
}

async function load(asset, cache, decoder) {
  const url = new URL(`./assets/audio/${asset.path}`, import.meta.url).href;
  const download = async mode => {
    const fetched = await fetch(url, { cache: mode });
    if (!fetched.ok) throw new Error('Audio asset unavailable');
    return fetched;
  };
  const read = response => asset.sample ? response.arrayBuffer() : response.blob();
  const size = body => body.size ?? body.byteLength;
  let response, source = 'cache';
  try { response = await cache?.match(url); } catch { /* Fall through to HTTP cache/network. */ }
  if (!response) { response = await download('force-cache'); source = 'http'; }
  let copy = response.clone(), body = await read(response);
  // A stale copy of a replaced file, from either cache, is replaced from the network.
  if (size(body) !== asset.bytes) { response = await download('reload'); source = 'network'; copy = response.clone(); body = await read(response); }
  if (source !== 'cache' && size(body) === asset.bytes) {
    try { await cache?.put(url, copy); } catch { /* The in-memory copy still works. */ }
  }
  if (asset.sample) {
    if (!decoder) throw new Error('Offline audio decoder unavailable');
    audioAssets.samples.set(asset.key, await decoder.decodeAudioData(body));
    return;
  }
  if (!body.size) throw new Error('Empty song');
  const songUrl = URL.createObjectURL(body);
  try {
    const player = await prepareSong(songUrl);
    audioAssets.songs.set(asset.key, songUrl);
    audioAssets.players.set(asset.key, player);
  } catch (error) { URL.revokeObjectURL(songUrl); throw error; }
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
        // Earlier versions cached by URL alone, so a replaced soundtrack kept playing.
        for (const name of await globalThis.caches?.keys() || []) if (name.startsWith('tyran-audio-') && name !== AUDIO_CACHE) globalThis.caches.delete(name).catch(() => {});
      } catch { /* Storage is optional. */ }
      const run = (queue, workers) => Promise.all(Array.from({ length: workers }, async () => {
        while (queue.length) {
          const asset = queue.shift();
          try { await load(asset, cache, decoder); progress.loaded++; }
          catch { progress.failed++; /* A missing effect uses the synthesizer; a missing song is left out. */ }
          finally { progress.completed++; notify(); }
        }
      }));
      // Small effects load in parallel; songs stream one after another beside them.
      await Promise.all([run([...effects], 4), run([...songs], 1)]);
    })();
    await Promise.race([loading, startup]);
    clearTimeout(timer);
    audioAssets.ready = progress.ready = true;
    notify(); listeners.clear();
    return { ...progress };
  })();
  return pending;
}
