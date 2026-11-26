/* Construction foley, vehicle engines and a recorded water impact. */
import { BURST_AT } from './celebration.js';

export function createSound() {
  const key = 'bridger-sound';
  let context = null, mix = null, master = null, noiseBuffer = null, engine = null;
  let splashBuffer = null, preparation = null;
  const lastBreak = new Map();
  let enabled = true;
  let deviceUnavailable = false;
  try { enabled = localStorage.getItem(key) !== 'off'; } catch { /* private mode */ }

  const ensure = (resume = true) => {
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context || deviceUnavailable) return null;
      try {
        context = new Context();
        configureOutput();
      } catch {
        context?.close?.().catch(() => {});
        context = mix = master = null;
        deviceUnavailable = true;
        return null;
      }
    }
    if (resume && context.state === 'suspended') context.resume().catch(() => {});
    return context;
  };
  function configureOutput() {
    mix = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    master = context.createGain();
    master.gain.value = 0.74;
    mix.connect(limiter).connect(master).connect(context.destination);
    // Two quiet, dark reflections from the banks leave the hammer attack clear.
    for (const [seconds, level, pan] of [[0.078, 0.13, -0.65], [0.143, 0.08, 0.7]]) {
      const echo = context.createDelay();
      echo.delayTime.value = seconds;
      const air = context.createBiquadFilter();
      air.frequency.value = 1700;
      const amount = context.createGain();
      amount.gain.value = level;
      const side = context.createStereoPanner();
      side.pan.value = pan;
      mix.connect(echo).connect(air).connect(amount).connect(side).connect(limiter);
    }
  }
  const unlock = () => {
    if (enabled) {
      deviceUnavailable = false;
      ensure();
    }
  };
  /* One decaying partial. */
  const tone = ({ type = 'sine', freq = 440, to = null, duration = 0.1, gain = 0.2, at = 0, attack = 0.004, output }) => {
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
    env.connect(output || mix);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  };
  /* Filtered noise with an optional sweep of the filter. */
  const noise = ({ duration = 0.1, gain = 0.2, filter = 2000, to = null, q = 1, type = 'lowpass', at = 0, attack = 0.002, output }) => {
    const c = enabled && ensure();
    if (!c || !noiseBuffer) return;
    const t0 = c.currentTime + at;
    const source = c.createBufferSource();
    source.buffer = noiseBuffer;
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
    env.connect(output || mix);
    source.start(t0, Math.random());
    source.stop(t0 + duration + 0.05);
  };
  /* A struck object: a click of noise plus partials that ring down, higher
     ones faster. Each hit is detuned a little so repeats don't sound canned. */
  const strike = ({ partials, decay, gain, click = 3000, at = 0, pitch = 1 }) => {
    const detune = pitch * (0.96 + Math.random() * 0.08);
    noise({ duration: 0.03, gain: gain * 0.9, filter: click, type: 'bandpass', q: 0.8, at });
    partials.forEach(([ratio, level], i) => tone({
      freq: ratio * detune, duration: decay / (1 + i * 0.6), gain: gain * level, at,
    }));
  };
  const WOOD = [[175, 0.8], [382, 0.5], [917, 0.32], [1570, 0.1]];
  const STEEL = [[233, 0.65], [536, 0.35], [859, 0.47], [872, 0.24], [2180, 0.22], [3270, 0.1]];
  // Sample the Karplus–Strong string at a few tensions up front. Playback
  // tunes the nearest note to the actual cable length.
  const cables = {
    place: { pitches: [75, 91, 110, 133, 160, 175], duration: 0.29 },
    snap: { pitches: [95], duration: 0.32 },
    creak: { pitches: [115, 130, 145], duration: 0.22 },
  };
  function makeString(c, pitch, duration) {
    const period = Math.round(c.sampleRate / pitch);
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate);
    const data = buffer.getChannelData(0);
    const loss = Math.exp(-4 / (pitch * duration));
    let previous = 0;
    for (let i = 0; i < data.length; i++) {
      if (i < period) {
        previous = 0.5 * previous + 0.5 * (Math.random() * 2 - 1);
        data[i] = previous;
      } else {
        data[i] = loss * 0.5 * (data[i - period] + data[i - period + 1]);
      }
    }
    return buffer;
  }
  const pluck = (effect, pitch, gain, bend) => {
    const c = enabled && ensure();
    const notes = cables[effect].samples;
    if (!c || !notes) return;
    const note = notes.reduce((best, n) => Math.abs(n.pitch - pitch) < Math.abs(best.pitch - pitch) ? n : best);
    const source = c.createBufferSource();
    source.buffer = note.buffer;
    const tuning = pitch / note.pitch;
    source.playbackRate.setValueAtTime(tuning * bend, c.currentTime);
    source.playbackRate.setTargetAtTime(tuning, c.currentTime, 0.07);
    const volume = c.createGain();
    volume.gain.value = gain;
    source.connect(volume).connect(mix);
    source.start();
  };

  // Road engines fire uneven exhaust pulses over a four-stroke cycle. A
  // steam engine has four separate bursts of exhaust per wheel revolution.
  const motors = new Map();
  function makeMotor(c, kind) {
    const steam = kind === 'train', diesel = kind === 'truck';
    const pulses = diesel ? 6 : 4;
    const cycles = steam ? 3 : 12;
    const cycleTime = steam ? 1.12 : diesel ? 0.113 : 0.068;
    const samples = Math.round(c.sampleRate * cycleTime * cycles);
    const buffer = c.createBuffer(1, samples, c.sampleRate);
    const data = buffer.getChannelData(0);
    let breath = 0;
    for (let i = 0; i < samples; i++) {
      const cycle = i / samples * cycles;
      const firing = cycle * pulses;
      const stroke = Math.floor(firing);
      const phase = firing - stroke;
      const attack = Math.min(1, phase * (steam ? 12 : 25));
      const accent = 0.8 + 0.2 * Math.cos(stroke % pulses * 2 * Math.PI / pulses);
      const envelope = attack * Math.exp(-(steam ? 6 : 5) * phase) * accent;
      breath = 0.72 * breath + 0.28 * (Math.random() * 2 - 1);
      if (steam) {
        data[i] = envelope * (2.7 * breath + 0.3 * Math.sin(phase * 65));
      } else {
        const exhaust = Math.sin(phase * 2 * Math.PI) + 0.4 * Math.sin(phase * 4 * Math.PI);
        const crank = Math.sin(cycle * 2 * Math.PI);
        data[i] = envelope * (exhaust + (diesel ? 0.78 : 0.28) * breath) + 0.1 * crank;
      }
    }
    return buffer;
  }
  function stopEngine() {
    if (!engine) return;
    const now = context.currentTime;
    // Release even when a player presses Stop at full volume. Ten time
    // constants take the waveform below -86 dB before the sources end.
    engine.gain.gain.setTargetAtTime(0, now, 0.02);
    engine.motor.stop(now + 0.2);
    engine.rolling.stop(now + 0.2);
    engine = null;
  }
  // A muted game or refused output device can prepare its buffers offline.
  // They can be played by a different AudioContext when sound is unlocked.
  async function prepareAudio() {
    let c = enabled && ensure(false);
    if (!c) {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) return;
      try { c = new Offline(1, 1, 44100); } catch { return; }
    }
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    for (const kind of ['car', 'truck', 'train']) motors.set(kind, makeMotor(c, kind));
    for (const cable of Object.values(cables)) {
      cable.samples = cable.pitches.map(pitch => ({ pitch, buffer: makeString(c, pitch, cable.duration) }));
    }
    const url = new URL('../assets/splash.mp3', import.meta.url);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Splash unavailable');
        splashBuffer = await c.decodeAudioData(await response.arrayBuffer());
        return;
      } catch {
        if (!navigator.onLine) break;
        // The prepared noise envelope supplies the impact if the recording fails.
      }
    }
  }
  const tap = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* not allowed */ } };

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch { /* private mode */ }
      if (enabled) unlock();
      else stopEngine();
      if (master) master.gain.setTargetAtTime(enabled ? 0.74 : 0, context.currentTime, 0.008);
      return enabled;
    },
    unlock,
    preload() {
      // Playback is optional when a device refuses sound buffers.
      return preparation ??= prepareAudio().catch(() => {});
    },
    /* A plank knocked into place, a girder bolted on, a cable pulled taut. */
    place(mat, length = 3) {
      const pitch = Math.max(0.65, Math.min(1.45, Math.sqrt(3 / length)));
      if (mat === 'steel') {
        // The bolt seats against the flange, then the heavier hammer lands.
        strike({ partials: STEEL, decay: 0.11, gain: 0.09, click: 4600, pitch });
        strike({ partials: STEEL, decay: 0.85, gain: 0.23, click: 3300, pitch, at: 0.063 });
      } else if (mat === 'cable') {
        pluck('place', (115 + Math.random() * 5) * pitch, 0.18, 0.985);
        noise({ duration: 0.025, gain: 0.045, filter: 1050, type: 'bandpass', q: 0.8 });
      } else if (mat === 'road') {
        noise({ duration: 0.15, filter: 1700, to: 230, gain: 0.45 });
        tone({ freq: 116, to: 57, duration: 0.18, gain: 0.27 });
      } else {
        noise({ duration: 0.055, gain: 0.23, filter: 3700, to: 880, type: 'bandpass' });
        strike({ partials: WOOD, decay: 0.19, gain: 0.36, click: 1350, pitch });
        strike({ partials: WOOD, decay: 0.085, gain: 0.1, click: 1700, pitch, at: 0.076 });
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
      const c = enabled && ensure();
      if (!c || c.currentTime - (lastBreak.get(mat) ?? -1) < 0.09) return;
      lastBreak.set(mat, c.currentTime);
      if (mat === 'steel' || mat === 'road') {
        noise({ duration: 0.35, gain: 0.35, filter: 2500, to: 600, type: 'bandpass', q: 0.7 });
        strike({ partials: STEEL, decay: 1.2, gain: 0.14, click: 4000 });
        tone({ freq: 90, to: 45, duration: 0.4, gain: 0.25 });
      } else if (mat === 'cable') {
        pluck('snap', 95, 0.35, 1.22);
        noise({ duration: 0.12, gain: 0.13, filter: 2600, to: 700, type: 'bandpass', q: 1 });
      } else {
        for (let i = 0; i < 6; i++) noise({ duration: 0.04 + Math.random() * 0.05, gain: 0.25, filter: 1500 + Math.random() * 2500, type: 'bandpass', q: 2, at: i * (0.015 + Math.random() * 0.03) });
        tone({ freq: 120, to: 55, duration: 0.3, gain: 0.25 });
      }
      tap(25);
    },
    /* A stressed joint slips in a cluster of tiny, uneven stick-slip knocks. */
    creak(level, mat) {
      const start = 115 + Math.random() * 30;
      if (mat === 'cable') {
        pluck('creak', start, 0.1 * level, 1.025);
        return;
      }
      for (let i = 0; i < 5; i++) {
        const at = i * 0.026 + i * i * 0.003 + Math.random() * 0.008;
        const pitch = start - i * 5;
        tone({ freq: pitch, to: pitch * 0.85, duration: 0.056, gain: 0.115 * level, at });
        noise({ filter: mat === 'steel' ? 2100 : 960, q: 2.5, type: 'bandpass', duration: 0.06, gain: 0.17 * level, at });
      }
    },
    splash(massKg = 1500, speed = 5, pan = 0) {
      const c = enabled && ensure();
      if (!c) return;
      const weight = Math.max(0, Math.min(1, Math.log2(massKg / 1500) / 3));
      const impact = Math.max(0.4, Math.min(1, speed / 7));
      if (!splashBuffer) {
        noise({ duration: 0.27, gain: 0.65 * impact, filter: 680, to: 150, attack: 0.008 });
        noise({ duration: 0.75, gain: 0.32 * impact, filter: 3600, to: 570, attack: 0.04, at: 0.025 });
        return;
      }
      const source = c.createBufferSource();
      source.buffer = splashBuffer;
      source.playbackRate.value = 0.94 - 0.22 * weight;
      const volume = c.createGain();
      volume.gain.value = (0.63 + 0.15 * weight) * impact;
      const position = c.createStereoPanner();
      position.pan.value = pan;
      source.connect(volume).connect(position).connect(mix);
      source.start();
    },
    /* A wreck hitting the ground or the river bed. */
    thud(strength = 1) {
      tone({ freq: 80, to: 40, duration: 0.35, gain: 0.3 * strength });
      noise({ duration: 0.25, gain: 0.25 * strength, filter: 900, to: 200 });
      strike({ partials: STEEL, decay: 0.5, gain: 0.05 * strength, click: 2500, at: 0.01 });
    },
    /* Match the motor and rolling sounds to the vehicle's position and
       load. The wheels mark each actual deck joint as an axle crosses it. */
    engine(on, car, pan = 0, level = 1) {
      level = Math.max(0, Math.min(1, level));
      const c = on && enabled && level > 0 && motors.has(car.id) && ensure();
      if (!c) { stopEngine(); return; }
      const kind = car.id;
      const train = kind === 'train';
      const now = c.currentTime;
      if (!engine) {
        const gain = c.createGain();
        gain.gain.value = 0;
        const position = c.createStereoPanner();
        position.pan.value = pan;
        gain.connect(position).connect(mix);
        const motorGain = c.createGain();
        motorGain.gain.value = train ? 0.42 : 0.28;
        motorGain.connect(gain);

        const motor = c.createBufferSource();
        motor.buffer = motors.get(kind);
        motor.loop = true;
        const exhaust = c.createBiquadFilter();
        exhaust.frequency.value = train ? 2300 : 820;
        exhaust.Q.value = 0.65;
        motor.connect(exhaust).connect(motorGain);
        const rolling = c.createBufferSource();
        rolling.buffer = noiseBuffer;
        rolling.loop = true;
        const surface = c.createBiquadFilter();
        surface.type = 'bandpass';
        surface.frequency.value = train ? 1540 : 490;
        surface.Q.value = 0.7;
        const rollingGain = c.createGain();
        rollingGain.gain.value = 0.15;
        rolling.connect(surface).connect(rollingGain).connect(motorGain);
        motor.start();
        rolling.start();
        engine = { gain, position, motor, exhaust, rolling, rollingGain, started: now, beams: car.axles.map(a => a.beam) };
      }
      const front = car.axles[0], rear = car.axles[kind === 'truck' ? 2 : 1];
      const grade = (front.y - rear.y) / Math.max(1, front.x - rear.x);
      const load = Math.max(-0.3, Math.min(0.45, grade));
      const throttle = Math.min(1, (now - engine.started) / 0.85);
      engine.motor.playbackRate.setTargetAtTime(train ? 1 : 0.78 + throttle * 0.24 + load * 0.5, now, 0.09);
      const cutoff = train ? 2200 : (kind === 'truck' ? 820 : 1100) * (1 + load);
      engine.exhaust.frequency.setTargetAtTime(cutoff * (0.65 + 0.35 * level), now, 0.09);
      engine.position.pan.setTargetAtTime(pan, now, 0.06);
      engine.gain.gain.setTargetAtTime(level, now, 0.07);
      engine.rollingGain.gain.setTargetAtTime(front.beam < 0 ? 0.23 : 0.11, now, 0.06);
      car.axles.forEach((axle, i) => {
        if (axle.beam >= 0 && axle.beam !== engine.beams[i]) {
          tone({ freq: train ? 420 : 97, to: train ? 365 : 64, gain: train ? 0.075 : 0.06, duration: 0.052, output: engine.gain });
          noise({ filter: train ? 2900 : 870, to: 620, type: 'bandpass', duration: 0.045, gain: train ? 0.19 : 0.11, output: engine.gain });
        }
        engine.beams[i] = axle.beam;
      });
    },
    win() {
      // Small bell attacks follow the light across the span. The high note
      // and a soft paper pop land together when the two banks' lights meet.
      for (const [at, freq] of [[0, 523.25], [0.16, 659.25], [0.35, 783.99], [BURST_AT, 1046.5]]) {
        tone({ freq, duration: 1.1, gain: 0.085, at });
        tone({ freq: freq * 2.76, duration: 0.35, gain: 0.018, at });
      }
      noise({ duration: 0.16, gain: 0.12, filter: 2100, to: 480, at: BURST_AT });
      [261.63, 392, 493.88, 659.25].forEach((freq) => tone({ type: 'triangle', freq, duration: 1.55, gain: 0.045, at: BURST_AT, attack: 0.06 }));
      tap([14, BURST_AT * 1000 - 14, 32]);
    },
    fail() {
      [392, 349.23, 293.66, 246.94].forEach((freq, i) => tone({ type: 'triangle', freq, to: freq * 0.97, duration: 0.45, gain: 0.08, at: 0.3 + i * 0.17 }));
    },
  };
}
