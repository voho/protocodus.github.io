/* Sound, synthesised.

   No files. Everything here is an oscillator or a second of white noise
   generated once at startup and filtered differently for each job, which
   keeps the whole game to the three hundred kilobytes of three.js and costs
   nothing to load.

   Four of the five sounds are continuous and driven straight from the
   physics, which is the point: the wind is the rider's speed, the hiss is
   how hard the edge is working, and both of them go silent in the air. That
   silence is the single most effective thing in here — a jump is quiet, and
   the landing is loud, and the ear gets the whole story without a single
   sample being triggered by an event.

   Everything is behind a user gesture, because browsers require it and
   because a page that starts making noise on its own deserves what it gets. */

const NOISE_SECONDS = 2;

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let wind = null;
  let carve = null;
  let muted = false;
  let started = false;

  try {
    muted = localStorage.getItem('alpen.muted') === '1';
  } catch { /* private mode; the default stands */ }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);

    const len = ctx.sampleRate * NOISE_SECONDS;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    // Brown-ish noise: white through a leaky integrator. Snow and wind are
    // both low-frequency rushes, and white noise reads as a broken speaker.
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.024 * w) / 1.024;
      d[i] = last * 3.2;
    }

    const loop = (type, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filter).connect(g).connect(master);
      src.start();
      return { src, filter, gain: g };
    };

    wind = loop('lowpass', 700, 0.7, 0);
    carve = loop('bandpass', 1900, 0.9, 0);
    return true;
  }

  /* Called on every resume, not just the first. Browsers suspend an
     AudioContext when the tab goes to the background or the device takes
     the audio away, and returning early on `started` left the graph running
     into a suspended context — permanently silent, with the HUD still
     saying the sound was on. */
  function start() {
    if (!ctx && !build()) return;
    started = true;
    if (ctx.state === 'suspended') ctx.resume();
  }

  const now = () => (ctx ? ctx.currentTime : 0);

  /* --- the two continuous voices -------------------------------------- */

  function ambience(speed, slide, grounded, storm) {
    if (!started || !ctx) return;
    const t = now();
    const v = Math.min(1, speed / 42);
    // In the air there is no snow under the board, so there is almost
    // nothing to hear — which is what makes the landing land
    const air = grounded ? 1 : 0.28;
    const gust = 0.05 + storm * 0.22;
    wind.gain.gain.setTargetAtTime((0.03 + v * v * 0.42) * air + gust, t, 0.12);
    wind.filter.frequency.setTargetAtTime(320 + v * 1500, t, 0.2);
    carve.gain.gain.setTargetAtTime(Math.min(0.5, slide * 0.06) * air, t, 0.05);
    carve.filter.frequency.setTargetAtTime(1200 + Math.min(slide, 14) * 190, t, 0.08);
  }

  /* --- one-shots ------------------------------------------------------- */

  function tone(freq, endFreq, dur, gain, type = 'sine', delay = 0) {
    if (!started || !ctx) return;
    const t = now() + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function burst(dur, freq, gain, type = 'lowpass', sweepTo = null) {
    if (!started || !ctx) return;
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  return {
    start,
    ambience,
    get muted() { return muted; },
    get running() { return started; },
    // For the debug hatch, and for checking that a suspended context has
    // actually been brought back rather than assumed to be running
    get context() { return ctx; },

    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      try { localStorage.setItem('alpen.muted', muted ? '1' : '0'); } catch { /* ignore */ }
      return muted;
    },

    // A pop, not a boing: the board leaves the snow, it does not launch
    jump(power) {
      tone(180 + power * 90, 70, 0.20, 0.18);
      burst(0.13, 2400, 0.10, 'highpass');
    },

    // Everything the snow takes, all at once
    land(impact) {
      const k = Math.min(1, impact / 18);
      burst(0.24 + k * 0.22, 900 + k * 900, 0.10 + k * 0.24, 'lowpass', 200);
      tone(90 + k * 40, 40, 0.16 + k * 0.1, 0.10 + k * 0.14);
    },

    // Rising blips, one per half rotation, so a 720 sounds like a 720
    trick(step) {
      tone(520 * Math.pow(1.16, step), 700 * Math.pow(1.16, step), 0.10, 0.10, 'triangle');
    },

    combo(mult) {
      tone(440 * Math.pow(1.06, mult), 880 * Math.pow(1.06, mult), 0.18, 0.09, 'triangle');
      tone(660 * Math.pow(1.06, mult), 1320, 0.16, 0.05, 'sine', 0.05);
    },

    crash() {
      burst(0.55, 1800, 0.34, 'lowpass', 120);
      tone(150, 45, 0.4, 0.16, 'sawtooth');
    },

    // A near miss is a whoosh past the ear, and the only reward for taking
    // a line close enough to a tree to regret it
    whoosh() {
      burst(0.22, 700, 0.16, 'bandpass', 2600);
    },

    thud() {
      burst(0.18, 500, 0.16, 'lowpass', 160);
    },

    quiet() {
      if (!started || !ctx) return;
      wind.gain.gain.setTargetAtTime(0, now(), 0.08);
      carve.gain.gain.setTargetAtTime(0, now(), 0.05);
    },
  };
}
