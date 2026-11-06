/* A quiet, fictional relay signal and receiver hiss. The short keyed pattern
   is sound design, not a transcribed wartime message or a human recording.
   Only explicitly active mission equipment receives a voice. */
export function createRadioAmbience({ ctx, output, makeNoise, occlusion, listener, random }) {
  const LIMIT = 2, REACH = 42, INTERVAL = .125;
  const voices = new Map(), retiring = new Set();
  let sources = [], signal = null, nextUpdate = 0, pathUpdates = 0, gateErrors = 0;

  function signalBuffer() {
    if (signal) return signal;
    const sr = ctx.sampleRate;
    signal = ctx.createBuffer(1, Math.floor(sr * 6.8), sr);
    const data = signal.getChannelData(0);
    // Sparse groups leave room for combat cues and keep the receiver from
    // becoming a continuous musical/telegraphic bed across the courtyard.
    for (const [start, lengths] of [[.2, [.075, .22, .075]], [3.1, [.22, .075, .075, .22]]]) {
      let at = start;
      for (const duration of lengths) {
        const count = Math.floor(duration * sr), offset = Math.floor(at * sr), frequency = 635 + random() * 8;
        for (let i = 0; i < count; i++) {
          const edge = Math.min(1, i / (sr * .006), (count - i) / (sr * .006));
          const envelope = .5 - Math.cos(Math.PI * Math.max(0, edge)) * .5;
          const phase = i * frequency / sr * Math.PI * 2;
          data[offset + i] = (Math.sin(phase) * .65 + Math.sin(phase * 2) * .06 + (random() * 2 - 1) * .015) * envelope;
        }
        at += duration + .11;
      }
    }
    return signal;
  }

  function enabled(source) {
    try { return !!(typeof source.active === 'function' ? source.active() : source.active); }
    catch { gateErrors++; return false; }
  }

  function makeVoice(source, time) {
    const carrier = ctx.createBufferSource(), hiss = makeNoise();
    carrier.buffer = signalBuffer(); carrier.loop = true;
    carrier.playbackRate.value = .997 + random() * .006;
    const signalGain = ctx.createGain(), hissGain = ctx.createGain();
    signalGain.gain.value = .065; hissGain.gain.value = .006;
    const hissBand = ctx.createBiquadFilter(); hissBand.type = 'bandpass'; hissBand.frequency.value = 1500; hissBand.Q.value = .65;
    const high = ctx.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 280; high.Q.value = .5;
    const path = ctx.createBiquadFilter(); path.type = 'lowpass'; path.frequency.value = 2500; path.Q.value = .5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    carrier.connect(signalGain).connect(high); hiss.connect(hissBand).connect(hissGain).connect(high);
    high.connect(path).connect(gain).connect(pan).connect(output);
    const voice = { source, carrier, hiss, path, gain, pan, nextPath: 0, transmission: { gain: 1, cutoff: 2500 } };
    let ended = 0;
    const release = () => {
      if (++ended < 2) return;
      for (const node of [carrier, hiss, signalGain, hissGain, hissBand, high, path, gain, pan]) node.disconnect();
      retiring.delete(voice);
    };
    carrier.onended = release; hiss.onended = release;
    carrier.start(time); hiss.start(time, random()); voices.set(source, voice);
    return voice;
  }

  function retire(voice, time) {
    voices.delete(voice.source); retiring.add(voice);
    voice.gain.gain.setTargetAtTime(0, time, .025);
    voice.carrier.stop(time + .1); voice.hiss.stop(time + .1);
  }

  function update(time) {
    if (time < nextUpdate) return;
    nextUpdate = time + INTERVAL;
    const nearest = [];
    for (const source of sources) {
      if (!source || !enabled(source) || ![source.x, source.y, source.z].every(Number.isFinite)) continue;
      const d2 = (source.x - listener.x) ** 2 + (source.y - listener.y) ** 2 + (source.z - listener.z) ** 2;
      if (d2 >= REACH ** 2) continue;
      const i = nearest.findIndex(candidate => d2 < candidate.d2);
      nearest.splice(i < 0 ? nearest.length : i, 0, { source, d2 });
      if (nearest.length > LIMIT) nearest.pop();
    }
    for (const voice of voices.values()) if (!nearest.some(candidate => candidate.source === voice.source)) retire(voice, time);
    let refreshed = false;
    for (const { source, d2 } of nearest) {
      let voice = voices.get(source);
      if (!voice && voices.size + retiring.size < LIMIT) voice = makeVoice(source, time);
      if (!voice) continue;
      if (!refreshed && time >= voice.nextPath) {
        voice.transmission = occlusion.sample(source.x, source.y, source.z, time);
        voice.nextPath = time + .65; refreshed = true; pathUpdates++;
      }
      const d = Math.sqrt(d2), angle = Math.atan2(source.x - listener.x, source.z - listener.z) - listener.yaw;
      const gain = 3 / Math.max(3, d) * (1 - d / REACH) ** 2 * voice.transmission.gain;
      voice.gain.gain.setTargetAtTime(gain, time, .06);
      voice.pan.pan.setTargetAtTime(-Math.sin(angle) * Math.min(1, d / 3), time, .035);
      voice.path.frequency.setTargetAtTime(Math.min(voice.transmission.cutoff, 2500 / (1 + d / 45)), time, .12);
    }
  }

  function stop() {
    for (const voice of [...voices.values()]) retire(voice, ctx.currentTime);
    nextUpdate = 0;
  }
  return {
    update, stop,
    setSources(list) { stop(); sources = Array.isArray(list) ? list : []; if (sources.length) signalBuffer(); },
    get status() { return { active: voices.size, retiring: retiring.size, max: LIMIT, sources: sources.length, pathUpdates, interval: INTERVAL, prepared: !!signal, textureBytes: signal ? signal.length * 4 : 0, gateErrors }; },
  };
}
