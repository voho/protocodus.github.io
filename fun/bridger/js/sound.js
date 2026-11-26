/* Synthesised sounds: nothing to download. The context opens on the first
   gesture, as browsers require. */
export function createSound() {
  const key = 'bridger-sound';
  let context = null, master = null, noiseBuffer = null, engine = null;
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
  const tone = ({ type = 'sine', freq = 440, to = null, duration = 0.1, gain = 0.2, at = 0 }) => {
    const c = enabled && ensure();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(env).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  };
  const noise = ({ duration = 0.1, gain = 0.2, filter = 2000, type = 'lowpass', at = 0 }) => {
    const c = enabled && ensure();
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
    const env = c.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(biquad).connect(env).connect(master);
    source.start(t0);
    source.stop(t0 + duration + 0.03);
  };
  const tap = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* not allowed */ } };

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch { /* private mode */ }
      if (!enabled) this.engine(false);
      return enabled;
    },
    unlock() { if (enabled) ensure(); },
    place(mat) {
      const freq = { road: 196, wood: 330, steel: 523, cable: 784 }[mat] || 330;
      tone({ type: 'triangle', freq, duration: 0.14, gain: 0.16 });
      noise({ duration: 0.04, gain: 0.08, filter: mat === 'steel' ? 5000 : 1500 });
      tap(8);
    },
    erase() { tone({ freq: 420, to: 220, duration: 0.12, gain: 0.1 }); },
    buzz() { tone({ type: 'square', freq: 110, duration: 0.14, gain: 0.05 }); tap([14, 30, 14]); },
    snap(mat) {
      noise({ duration: 0.22, gain: 0.32, filter: mat === 'steel' ? 4200 : 1400, type: 'bandpass' });
      tone({ type: 'sawtooth', freq: mat === 'steel' ? 900 : 260, to: 80, duration: 0.18, gain: 0.08 });
      tap(25);
    },
    splash() { noise({ duration: 0.9, gain: 0.35, filter: 900 }); noise({ duration: 0.5, gain: 0.12, filter: 3000, type: 'highpass', at: 0.05 }); },
    /* A soft engine hum while the vehicle drives. */
    engine(on, pitch = 1) {
      const c = on && enabled && ensure();
      if (!c) {
        if (engine) { engine.gain.gain.setTargetAtTime(0, context.currentTime, 0.08); const e = engine; setTimeout(() => e.osc.stop(), 400); engine = null; }
        return;
      }
      if (!engine) {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 380;
        const gain = c.createGain();
        gain.gain.value = 0;
        osc.connect(filter).connect(gain).connect(master);
        osc.start();
        gain.gain.setTargetAtTime(0.05, c.currentTime, 0.2);
        engine = { osc, gain };
      }
      engine.osc.frequency.setTargetAtTime(48 * pitch, c.currentTime, 0.1);
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => tone({ type: 'triangle', freq, duration: 0.9, gain: 0.13, at: i * 0.1 }));
      tap([30, 50, 30, 50, 60]);
    },
    fail() { [392, 330, 262].forEach((freq, i) => tone({ type: 'triangle', freq, duration: 0.35, gain: 0.1, at: i * 0.16 })); },
  };
}
