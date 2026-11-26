/* Synthesised sounds: nothing to download. Impacts are modal (a few
   inharmonic partials ringing down, the way a struck plank or girder does),
   everything runs through a small room reverb, and the context opens on the
   first gesture, as browsers require. */
export function createSound() {
  const key = 'bridger-sound';
  let context = null, master = null, wet = null, noiseBuffer = null, engine = null;
  let enabled = true;
  try { enabled = localStorage.getItem(key) !== 'off'; } catch { /* private mode */ }

  const ensure = () => {
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      context = new Context();
      const out = context.createDynamicsCompressor();
      out.threshold.value = -14;
      out.connect(context.destination);
      master = context.createGain();
      master.gain.value = 0.55;
      master.connect(out);
      // Reverb: an impulse of decaying noise, sent at a low level.
      const length = Math.floor(context.sampleRate * 1.4);
      const impulse = context.createBuffer(2, length, context.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
      }
      const reverb = context.createConvolver();
      reverb.buffer = impulse;
      wet = context.createGain();
      wet.gain.value = 0.22;
      wet.connect(reverb).connect(out);
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  };
  const route = (node) => { node.connect(master); node.connect(wet); };
  const getNoise = (c) => {
    if (!noiseBuffer) {
      noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  };

  /* One decaying partial. */
  const tone = ({ type = 'sine', freq = 440, to = null, duration = 0.1, gain = 0.2, at = 0, attack = 0.004 }) => {
    const c = enabled && ensure();
    if (!c) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(env);
    route(env);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  };
  /* Filtered noise with an optional sweep of the filter. */
  const noise = ({ duration = 0.1, gain = 0.2, filter = 2000, to = null, q = 1, type = 'lowpass', at = 0, attack = 0.002 }) => {
    const c = enabled && ensure();
    if (!c) return;
    const t0 = c.currentTime + at;
    const source = c.createBufferSource();
    source.buffer = getNoise(c);
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    const biquad = c.createBiquadFilter();
    biquad.type = type;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(filter, t0);
    if (to) biquad.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(biquad).connect(env);
    route(env);
    source.start(t0, Math.random());
    source.stop(t0 + duration + 0.05);
  };
  /* A struck object: a click of noise plus partials that ring down, higher
     ones faster. Each hit is detuned a little so repeats don't sound canned. */
  const strike = ({ partials, decay, gain, click = 3000, at = 0 }) => {
    const detune = 0.97 + Math.random() * 0.06;
    noise({ duration: 0.03, gain: gain * 0.9, filter: click, type: 'bandpass', q: 0.8, at });
    partials.forEach(([ratio, level], i) => tone({
      freq: ratio * detune, duration: decay / (1 + i * 0.6), gain: gain * level, at,
    }));
  };
  const WOOD = [[310, 1], [702, 0.45], [1180, 0.25], [1930, 0.12]];
  const STEEL = [[520, 0.7], [1404, 0.5], [2690, 0.35], [4370, 0.2], [6100, 0.1]];
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
    /* A plank knocked into place, a girder bolted on, a cable pulled taut. */
    place(mat) {
      if (mat === 'steel') {
        strike({ partials: STEEL, decay: 0.55, gain: 0.12, click: 5000 });
        noise({ duration: 0.05, gain: 0.05, filter: 7000, type: 'highpass', at: 0.06 });
      } else if (mat === 'cable') {
        tone({ type: 'sawtooth', freq: 140, to: 210, duration: 0.5, gain: 0.05 });
        tone({ freq: 420, to: 630, duration: 0.45, gain: 0.05 });
        noise({ duration: 0.12, gain: 0.05, filter: 3500, type: 'bandpass', q: 3 });
      } else {
        strike({ partials: WOOD, decay: 0.22, gain: 0.2, click: 1800 });
      }
      tap(8);
    },
    erase() {
      noise({ duration: 0.22, gain: 0.12, filter: 3000, to: 500, type: 'bandpass', q: 1.5 });
      strike({ partials: [[180, 1], [410, 0.4]], decay: 0.12, gain: 0.1, click: 900, at: 0.02 });
    },
    buzz() {
      strike({ partials: [[120, 1], [250, 0.3]], decay: 0.12, gain: 0.16, click: 500 });
      strike({ partials: [[100, 1], [210, 0.3]], decay: 0.14, gain: 0.14, click: 400, at: 0.11 });
      tap([14, 30, 14]);
    },
    /* A member giving way: wood splinters with a crackle, steel shears with
       a ringing bang, a cable whips. */
    snap(mat) {
      if (mat === 'steel' || mat === 'road') {
        noise({ duration: 0.35, gain: 0.35, filter: 2500, to: 600, type: 'bandpass', q: 0.7 });
        strike({ partials: STEEL, decay: 1.2, gain: 0.14, click: 4000 });
        tone({ freq: 90, to: 45, duration: 0.4, gain: 0.25 });
      } else if (mat === 'cable') {
        tone({ type: 'sawtooth', freq: 900, to: 90, duration: 0.35, gain: 0.08 });
        noise({ duration: 0.25, gain: 0.2, filter: 6000, to: 800, type: 'bandpass', q: 2 });
      } else {
        for (let i = 0; i < 6; i++) noise({ duration: 0.04 + Math.random() * 0.05, gain: 0.25, filter: 1500 + Math.random() * 2500, type: 'bandpass', q: 2, at: i * (0.015 + Math.random() * 0.03) });
        tone({ freq: 120, to: 55, duration: 0.3, gain: 0.25 });
      }
      tap(25);
    },
    /* Strained timber groaning, louder and lower the closer the bridge is to breaking. */
    creak(level) {
      const c = enabled && ensure();
      if (!c) return;
      const t0 = c.currentTime;
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      const base = 70 + Math.random() * 60;
      osc.frequency.setValueAtTime(base, t0);
      for (let i = 1; i <= 6; i++) osc.frequency.linearRampToValueAtTime(base * (0.8 + Math.random() * 0.5), t0 + i * 0.06);
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 700 + Math.random() * 500; filter.Q.value = 6;
      const env = c.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.05 + level * 0.1, t0 + 0.08);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
      osc.connect(filter).connect(env);
      route(env);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    },
    splash() {
      noise({ duration: 1.3, gain: 0.45, filter: 2400, to: 300 });
      noise({ duration: 0.5, gain: 0.15, filter: 4000, type: 'highpass', at: 0.04 });
      tone({ freq: 70, to: 35, duration: 0.5, gain: 0.3 });
      for (let i = 0; i < 9; i++) {
        const f = 400 + Math.random() * 900;
        tone({ freq: f, to: f * 2.2, duration: 0.06 + Math.random() * 0.06, gain: 0.04, at: 0.25 + Math.random() * 0.9 });
      }
    },
    /* A wreck hitting the ground or the river bed. */
    thud(strength = 1) {
      tone({ freq: 80, to: 40, duration: 0.35, gain: 0.3 * strength });
      noise({ duration: 0.25, gain: 0.25 * strength, filter: 900, to: 200 });
      strike({ partials: STEEL, decay: 0.5, gain: 0.05 * strength, click: 2500, at: 0.01 });
    },
    /* The engine while the vehicle drives: two detuned saws and a sub through
       a lowpass that opens with speed, with tyre or rail noise under it. A
       train chugs: its filter pulses. */
    engine(on, pitch = 1, kind = 'car') {
      const c = on && enabled && ensure();
      if (!c) {
        if (engine) {
          const e = engine;
          e.gain.gain.setTargetAtTime(0, context.currentTime, 0.08);
          setTimeout(() => e.parts.forEach((p) => p.stop()), 500);
          engine = null;
        }
        return;
      }
      if (!engine) {
        const base = { car: 62, truck: 44, train: 36 }[kind] || 50;
        const gain = c.createGain();
        gain.gain.value = 0;
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 420; filter.Q.value = 2;
        filter.connect(gain);
        route(gain);
        const parts = [];
        const oscs = [[base, 'sawtooth', 0.5], [base * 1.007, 'sawtooth', 0.5], [base / 2, 'sine', 0.9]].map(([f, type, level]) => {
          const osc = c.createOscillator();
          osc.type = type; osc.frequency.value = f;
          const g = c.createGain(); g.gain.value = level;
          osc.connect(g).connect(filter);
          osc.start(); parts.push(osc);
          return osc;
        });
        // Rumble: a slow wobble on the filter.
        const lfo = c.createOscillator();
        lfo.frequency.value = kind === 'train' ? 2.2 : 9;
        const depth = c.createGain(); depth.gain.value = kind === 'train' ? 260 : 80;
        lfo.connect(depth).connect(filter.frequency);
        lfo.start(); parts.push(lfo);
        const road = c.createBufferSource();
        road.buffer = getNoise(c); road.loop = true;
        const roadFilter = c.createBiquadFilter();
        roadFilter.type = 'bandpass'; roadFilter.frequency.value = kind === 'train' ? 2400 : 700; roadFilter.Q.value = 0.8;
        const roadGain = c.createGain(); roadGain.gain.value = kind === 'train' ? 0.05 : 0.035;
        road.connect(roadFilter).connect(roadGain).connect(gain);
        road.start(); parts.push(road);
        gain.gain.setTargetAtTime(0.09, c.currentTime, 0.25);
        engine = { gain, oscs, base, parts };
      }
      engine.oscs.forEach((osc, i) => osc.frequency.setTargetAtTime(engine.base * [1, 1.007, 0.5][i] * pitch, c.currentTime, 0.1));
    },
    win() {
      // A bright bell arpeggio over a warm chord.
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        tone({ freq, duration: 1.4, gain: 0.1, at: i * 0.11 });
        tone({ freq: freq * 2.76, duration: 0.5, gain: 0.025, at: i * 0.11 });
      });
      [261.63, 329.63, 392].forEach((freq) => tone({ type: 'triangle', freq, duration: 1.8, gain: 0.05, at: 0.42, attack: 0.15 }));
      tap([30, 50, 30, 50, 60]);
    },
    fail() {
      [392, 349.23, 293.66, 246.94].forEach((freq, i) => tone({ type: 'triangle', freq, to: freq * 0.97, duration: 0.45, gain: 0.08, at: 0.3 + i * 0.17 }));
    },
  };
}
