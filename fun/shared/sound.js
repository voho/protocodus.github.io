/* Small synthesised sounds for the puzzles: no files, nothing to load. The
   context opens on the first gesture, as browsers require. */
export function createSound(storageKey) {
  const key = `${storageKey}-sound`;
  let context = null;
  let master = null;
  let enabled = true;
  try { enabled = localStorage.getItem(key) !== 'off'; } catch { /* private mode */ }

  const ensure = () => {
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      context = new Context();
      master = context.createGain();
      master.gain.value = 0.4;
      master.connect(context.destination);
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  };

  const tone = ({ type = 'sine', freq = 440, to = null, duration = 0.1, gain = 0.3, attack = 0.004, at = 0 }) => {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0, t0);
    envelope.gain.linearRampToValueAtTime(gain, t0 + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(envelope).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  };

  let noiseBuffer = null;
  const noise = ({ duration = 0.08, gain = 0.2, filter = 2000, type = 'lowpass', at = 0 }) => {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    if (!noiseBuffer) {
      noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + at;
    const source = c.createBufferSource();
    source.buffer = noiseBuffer;
    const biquad = c.createBiquadFilter();
    biquad.type = type;
    biquad.frequency.value = filter;
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(gain, t0);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(biquad).connect(envelope).connect(master);
    source.start(t0);
    source.stop(t0 + duration + 0.03);
  };

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch { /* private mode */ }
      if (enabled) ensure();
      return enabled;
    },
    unlock() { if (enabled) ensure(); },
    /* A line grows: a blip that rises with how much of the board is done. */
    step(progress) {
      tone({ freq: 520 * 2 ** progress, duration: 0.09, gain: 0.16 });
      tone({ type: 'triangle', freq: 1040 * 2 ** progress, duration: 0.05, gain: 0.04 });
    },
    back() { tone({ freq: 380, to: 290, duration: 0.08, gain: 0.1 }); },
    number() {
      tone({ freq: 880, duration: 0.18, gain: 0.14 });
      tone({ freq: 1320, duration: 0.26, gain: 0.1, at: 0.05 });
    },
    /* A patch lands: a thump with a click on top. */
    place() {
      tone({ freq: 230, to: 80, duration: 0.16, gain: 0.34 });
      noise({ duration: 0.05, gain: 0.16, filter: 1800 });
    },
    lift() {
      noise({ duration: 0.16, gain: 0.1, filter: 900, type: 'highpass' });
      tone({ type: 'triangle', freq: 300, to: 520, duration: 0.14, gain: 0.07 });
    },
    buzz() {
      tone({ type: 'square', freq: 110, duration: 0.14, gain: 0.06 });
      tone({ type: 'square', freq: 117, duration: 0.14, gain: 0.045 });
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) => {
        tone({ type: 'triangle', freq, duration: 1.1, gain: 0.14, at: i * 0.09 });
        tone({ freq: freq * 2, duration: 0.5, gain: 0.04, at: i * 0.09 });
      });
      noise({ duration: 0.9, gain: 0.05, filter: 6000, type: 'highpass', at: 0.1 });
    },
  };
}
