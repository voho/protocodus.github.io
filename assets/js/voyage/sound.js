/* Ambient sound, opt-in and synthesised. Nothing is fetched and nothing plays
   until the visitor asks: the AudioContext is created inside the toggle's own
   click, which is the gesture browsers require anyway. The mix is a low
   engine drone, a slow filtered-noise wash, and two one-shots — a UI blip and
   the warp sweep. All of it is a few oscillators; there are no samples. */

export function createSound() {
  let ctx = null;
  let master = null;
  let on = false;

  const build = () => {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // The drone: two detuned saws through a dark lowpass — engineering deck
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 110;
    lp.connect(droneGain).connect(master);
    for (const f of [36, 36.6, 72.2]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f > 50 ? 0.25 : 1;
      o.connect(g).connect(lp);
      o.start();
    }

    // The wash: looped noise through a wandering bandpass — solar wind
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    bp.Q.value = 1.2;
    const washGain = ctx.createGain();
    washGain.gain.value = 0.016;
    noise.connect(bp).connect(washGain).connect(master);
    noise.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(bp.frequency);
    lfo.start();
  };

  return {
    get on() { return on; },
    toggle() {
      if (!ctx) build();
      if (ctx.state === 'suspended') ctx.resume();
      on = !on;
      master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.4);
      return on;
    },
    /* Silence is part of disposal: the oscillators outlive the renderer
       otherwise, droning behind a page that says text mode is on. */
    dispose() {
      if (!ctx) return;
      try {
        master.gain.value = 0;
        ctx.close();
      } catch { /* already closing */ }
      ctx = null;
      on = false;
    },
    blip(freq = 880) {
      if (!on || !ctx) return;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      o.connect(g).connect(master);
      o.start();
      o.stop(ctx.currentTime + 0.14);
    },
    warp() {
      if (!on || !ctx) return;
      const t0 = ctx.currentTime;
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(180, t0);
      bp.frequency.exponentialRampToValueAtTime(3600, t0 + 0.45);
      bp.frequency.exponentialRampToValueAtTime(120, t0 + 1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.05);
      src.connect(bp).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + 1.1);
    },
  };
}
