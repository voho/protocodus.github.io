/* Locally bundled CC0 recordings. Source, edits and checksums live in
   assets/audio/manifest.json; playback never calls a third-party service. */
const variants = (stem, count, ext = 'ogg') => Array.from({ length: count }, (_, i) => `${stem}${String(i).padStart(ext === 'ogg' ? 3 : 1, '0')}.${ext}`);

export const SOUND_SAMPLES = Object.freeze({
  rifle: variants('rifle-30-06-', 2, 'wav'),
  bolt: variants('rifle-762-', 2, 'wav'),
  automatic45: variants('pistol-45-', 2, 'wav'),
  automatic9: variants('smg-9mm-', 3, 'wav'),
  hard: variants('footstep_concrete_', 3),
  grass: variants('footstep_grass_', 3),
  wood: variants('footstep_wood_', 3),
  metalImpact: variants('impactMetal_light_', 2),
  woodImpact: variants('impactWood_light_', 2),
  stoneImpact: variants('impactGeneric_light_', 2),
  body: variants('impactSoft_heavy_', 2),
  cloth: ['cloth1.ogg', 'cloth2.ogg'],
  belt: ['beltHandle1.ogg'],
  click: ['metalClick.ogg'],
  latch: ['metalLatch.ogg'],
  paper: ['bookFlip1.ogg'],
});

export function createSampleBank(ctx, { fetcher = globalThis.fetch, random = Math.random, maxVoices = 48 } = {}) {
  const buffers = new Map(), previous = new Map(), voices = new Set();
  const files = [...new Set(Object.values(SOUND_SAMPLES).flat())];
  let loading = null, loaded = 0, failed = 0;

  function preload() {
    if (loading) return loading;
    let cursor = 0;
    // Four workers keep decoding/network work bounded while the scene loads.
    loading = Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        try {
          const response = await fetcher(new URL(`../assets/audio/${file}`, import.meta.url));
          if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
          const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
          buffers.set(file, buffer); loaded++;
        } catch { failed++; } // Synthesis remains available, including unsupported codecs.
      }
    })).then(() => ({ loaded, failed, total: files.length }));
    return loading;
  }

  function play(group, out, when, { gain = 1, rate = 1, priority = false } = {}) {
    const available = (SOUND_SAMPLES[group] || []).filter(file => buffers.has(file));
    if (!available.length) return false;
    // Do not fall back to an unbounded synthetic voice when the budget is full.
    if (voices.size >= maxVoices) {
      if (!priority) return true;
      const oldest = voices.values().next().value;
      oldest.stop(); voices.delete(oldest);
    }
    let candidates = available.filter(file => file !== previous.get(group));
    if (!candidates.length) candidates = available;
    const file = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
    previous.set(group, file);
    const source = ctx.createBufferSource(), level = ctx.createGain();
    source.buffer = buffers.get(file);
    source.playbackRate.value = Math.max(0.5, Math.min(2, rate));
    level.gain.value = Math.max(0, gain);
    source.connect(level).connect(out);
    voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); level.disconnect(); };
    source.start(Math.max(ctx.currentTime, when));
    return true;
  }

  return { preload, play, get status() { return { loaded, failed, total: files.length, voices: voices.size }; } };
}

/* Game yaw points along +Z, with -X at camera right. Keep this pure so
   direction, obstruction and distance falloff can be verified without a GPU. */
export function spatialProfile(listener, source, { ref = 6, max = 400, occlusion = 0, lowpassFar = true } = {}) {
  const dx = source.x - listener.x, dy = source.y - listener.y, dz = source.z - listener.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance >= max) return null;
  const angle = Math.atan2(dx, dz) - listener.yaw;
  const blocked = Math.max(0, Math.min(1, Number.isFinite(occlusion) ? occlusion : 0));
  const behind = Math.max(0, -Math.cos(angle));
  return {
    distance,
    gain: (ref / Math.max(ref, distance)) * (1 - distance / max) * (1 - blocked * 0.48),
    pan: Math.max(-1, Math.min(1, -Math.sin(angle) * Math.min(1, distance / 3))),
    cutoff: Math.max(420, (lowpassFar ? 16000 / (1 + distance / 18) : 18000) * (1 - behind * 0.28) * (1 - blocked * 0.91)),
  };
}
