/* Quiet, local fire texture. Four shared-buffer voices at most; no source
   files or repeating dramatic bed. The visual fire objects stay authoritative
   (`on`, position and size), and the closest flames are heard in world space. */
export function createFireAmbience({ ctx, output, makeNoise, occlusion, listener, random }) {
  const MAX_VOICES = 4, REACH = 65, INTERVAL = 0.25;
  const voices = new Map(), retiring = new Set();
  let sources = [], texture = null, nextUpdate = 0, pathUpdates = 0;

  function fireTexture() {
    if (texture) return texture;
    const seconds = 9.7, sr = ctx.sampleRate;
    texture = ctx.createBuffer(1, Math.floor(sr * seconds), sr);
    const data = texture.getChannelData(0);
    for (let k = 0; k < 110; k++) {
      const duration = .008 + random() ** 2 * .11, count = Math.floor(sr * duration);
      const at = Math.floor(random() * (data.length - count - 1));
      const amp = .07 + random() ** 3 * .65, frequency = 600 + random() * 2900;
      for (let i = 0; i < count; i++) {
        const u = i / count, attack = Math.min(1, i / Math.max(1, sr * .001));
        data[at + i] += ((random() * 2 - 1) * .7 + Math.sin(i * frequency / sr * Math.PI * 2) * .3) * amp * attack * Math.exp(-u * 6);
      }
    }
    return texture;
  }

  function makeVoice(fire, time) {
    const roar = makeNoise(true), crackle = ctx.createBufferSource();
    crackle.buffer = fireTexture(); crackle.loop = true; crackle.playbackRate.value = .92 + random() * .16;
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 420; low.Q.value = .4;
    const roarGain = ctx.createGain(), crackleGain = ctx.createGain();
    roarGain.gain.value = .075; crackleGain.gain.value = .17;
    const path = ctx.createBiquadFilter(); path.type = 'lowpass'; path.frequency.value = 6000; path.Q.value = .5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    roar.connect(low).connect(roarGain).connect(path);
    crackle.connect(crackleGain).connect(path);
    path.connect(gain).connect(pan).connect(output);
    const voice = { fire, roar, crackle, path, gain, pan, transmission: { gain: 1, cutoff: 6000 }, nextPath: 0 };
    let ended = 0;
    const release = () => {
      if (++ended < 2) return;
      for (const node of [roar, crackle, low, roarGain, crackleGain, path, gain, pan]) node.disconnect();
      retiring.delete(voice);
    };
    roar.onended = release; crackle.onended = release;
    roar.start(time, random()); crackle.start(time, random() * crackle.buffer.duration);
    voices.set(fire, voice);
    return voice;
  }

  function retire(voice, time, fade = .18) {
    voices.delete(voice.fire); retiring.add(voice);
    voice.gain.gain.setTargetAtTime(0, time, fade / 3);
    voice.roar.stop(time + fade); voice.crackle.stop(time + fade);
  }

  function update(time) {
    if (time < nextUpdate) return;
    nextUpdate = time + INTERVAL;
    const nearest = [];
    for (const fire of sources) {
      if (!fire || fire.on === false || fire.size === 0 || ![fire.x, fire.y, fire.z].every(Number.isFinite)) continue;
      const d2 = (fire.x - listener.x) ** 2 + (fire.y - listener.y) ** 2 + (fire.z - listener.z) ** 2;
      if (d2 >= REACH ** 2) continue;
      const i = nearest.findIndex(candidate => d2 < candidate.d2);
      nearest.splice(i < 0 ? nearest.length : i, 0, { fire, d2 });
      if (nearest.length > MAX_VOICES) nearest.pop();
    }
    for (const voice of voices.values()) if (!nearest.some(candidate => candidate.fire === voice.fire)) retire(voice, time);
    // Only one persistent emitter may refresh its world path in an update.
    // Direct one-shot danger cues share the same strictly bounded cache.
    let refreshed = false;
    for (const { fire, d2 } of nearest) {
      let voice = voices.get(fire);
      if (!voice && voices.size + retiring.size < MAX_VOICES) voice = makeVoice(fire, time);
      if (!voice) continue;
      if (!refreshed && time >= voice.nextPath) {
        voice.transmission = occlusion.sample(fire.x, fire.y + .4, fire.z, time);
        voice.nextPath = time + 0.8; refreshed = true; pathUpdates++;
      }
      const d = Math.sqrt(d2), angle = Math.atan2(fire.x - listener.x, fire.z - listener.z) - listener.yaw;
      const size = Math.max(.1, Math.min(2.5, Number.isFinite(fire.size) ? fire.size : 1));
      const gain = Math.sqrt(size) * 4 / (4 + d) * (1 - d / REACH) ** 2 * voice.transmission.gain;
      voice.gain.gain.setTargetAtTime(gain, time, .12);
      voice.pan.pan.setTargetAtTime(-Math.sin(angle) * Math.min(1, d / 3), time, .08);
      voice.path.frequency.setTargetAtTime(Math.min(voice.transmission.cutoff, 6500 / (1 + d / 20)), time, .15);
    }
  }

  function stop() {
    for (const voice of [...voices.values()]) retire(voice, ctx.currentTime);
    nextUpdate = 0;
  }
  return {
    update, stop,
    // The game's loading stage can allocate the one shared texture before
    // a player frame; no per-fire buffer generation is needed after that.
    warm() { fireTexture(); },
    setSources(fires) { stop(); sources = Array.isArray(fires) ? fires : []; },
    get status() { return { active: voices.size, retiring: retiring.size, max: MAX_VOICES, sources: sources.length, pathUpdates, interval: INTERVAL, prepared: !!texture, textureBytes: texture ? texture.length * 4 : 0 }; },
  };
}
