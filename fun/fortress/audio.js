// The simulation supplies contact material, impact strength, and position. The
// sound bank is generated locally and uses one playback voice per event.
const RATE = 32000;
const cues = {
  // Render length, minimum retrigger interval, playback priority.
  launch: [0.63, 0.12, 3],
  'guard-shot': [0.33, 0.12, 2],
  impact: [0.46, 0.07, 1],
  'earth-hit': [0.34, 0.09, 1],
  'stone-hit': [0.37, 0.075, 1],
  'wood-hit': [0.3, 0.075, 1],
  'steel-hit': [0.68, 0.09, 1],
  'glass-hit': [0.48, 0.09, 1],
  stone: [0.76, 0.085, 0],
  wood: [0.53, 0.075, 0],
  glass: [0.85, 0.12, 0],
  steel: [0.92, 0.13, 0],
  burnout: [0.56, 0.14, 0],
  'stone-dust': [0.46, 0.14, 0],
  explosion: [1.18, 0.095, 3],
  barrel: [1.1, 0.095, 3],
  fireburst: [0.95, 0.08, 3],
  implosion: [0.82, 0.12, 3],
  crackle: [0.85, 0.4, 0],
  ignite: [1.42, 0.3, 1],
  extinguish: [0.48, 0.2, 1],
  faint: [0.5, 0.16, 2],
  clear: [1.3, 0.9, 4],
};
const materials = new Set(['stone', 'wood', 'glass', 'steel']);
const variation = (amount) => 1 + (Math.random() * 2 - 1) * amount;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function synthesize(sound) {
  const data = new Float32Array(Math.ceil(cues[sound][0] * RATE));

  function ring(at, seconds, level, pitch, end = pitch, attack = 0.002) {
    const offset = Math.round(at * RATE);
    const count = Math.min(Math.ceil(seconds * RATE), data.length - offset);
    let phase = 0,
      amplitude = level,
      hz = pitch;
    const fall = Math.exp(-5 / count),
      bend = (end / pitch) ** (1 / count);
    for (let i = 0; i < count; i++) {
      phase += (2 * Math.PI * hz) / RATE;
      data[offset + i] += Math.sin(phase) * amplitude * Math.min(1, i / (attack * RATE));
      amplitude *= fall;
      hz *= bend;
    }
  }

  // Filtered, decaying noise. A descending cutoff turns a hard crack into
  // rolling dust; a slower attack produces the air displaced by the sling.
  function grit(at, seconds, level, low, high, attack = 0.001, finalHigh = high) {
    const offset = Math.round(at * RATE);
    const count = Math.min(Math.ceil(seconds * RATE), data.length - offset);
    const coefficient = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / RATE);
    let upper = coefficient(high),
      slow = 0,
      fast = 0,
      amplitude = level;
    const lower = coefficient(low),
      fall = Math.exp(-5 / count);
    const sweep = (coefficient(finalHigh) / upper) ** (1 / count);
    for (let i = 0; i < count; i++) {
      const impulse = 2 * Math.random() - 1;
      fast += upper * (impulse - fast);
      slow += lower * (impulse - slow);
      data[offset + i] += (fast - slow) * amplitude * Math.min(1, i / (attack * RATE));
      amplitude *= fall;
      upper *= sweep;
    }
  }

  // A short damped delay line gives the released sling a fibrous twang.
  function cord(at, pitch, level, seconds) {
    const period = Math.round(RATE / pitch);
    const wire = Float32Array.from({ length: period }, () => Math.random() * 2 - 1);
    const count = Math.round(seconds * RATE),
      offset = Math.round(at * RATE);
    const loss = Math.exp(-3 / (seconds * pitch));
    for (let i = 0; i < count && offset + i < data.length; i++) {
      const j = i % period,
        v = wire[j];
      wire[j] = loss * (0.56 * v + 0.44 * wire[(j + 1) % period]);
      data[offset + i] += v * level * Math.min(1, i / 90);
    }
  }

  // Each successive debris contact comes sooner and carries less energy.
  function tumble(at, spacing, count, level, pitch, brightness) {
    for (let i = 0; i < count; i++) {
      const f = pitch * variation(0.24);
      grit(at, 0.046, level, 400, brightness);
      ring(at, 0.076, level * 0.25, f, f * 0.84);
      at += spacing * variation(0.13);
      spacing *= 0.76;
      level *= 0.77;
    }
  }

  switch (sound) {
    case 'guard-shot':
      grit(0, 0.045, 0.82, 650, 6200);
      ring(0.012, 0.13, 0.34, 225, 80);
      grit(0.04, 0.18, 0.25, 250, 2100);
      break;
    case 'launch':
      grit(0, 0.09, 0.57, 540, 3100);
      ring(0.014, 0.22, 0.46, 172, 79);
      cord(0.025, 114, 0.9, 0.32);
      cord(0.034, 226, 0.39, 0.16);
      grit(0.043, 0.46, 1.18, 200, 3650, 0.058, 560);
      ring(0.145, 0.25, 0.24, 103, 62);
      grit(0.144, 0.074, 0.49, 260, 1720);
      break;
    case 'impact':
      ring(0, 0.35, 0.78, 138, 43);
      ring(0.004, 0.13, 0.23, 288, 166);
      grit(0, 0.22, 0.86, 85, 2300, 0.001, 440);
      tumble(0.11, 0.105, 3, 0.32, 345, 2200);
      break;
    case 'earth-hit':
      ring(0, 0.24, 0.63, 107, 44);
      grit(0.002, 0.23, 1.65, 65, 920, 0.003, 280);
      tumble(0.046, 0.073, 3, 0.19, 180, 1280);
      break;
    case 'stone-hit':
      grit(0, 0.06, 1.15, 520, 3050);
      ring(0, 0.16, 0.61, 265, 134);
      ring(0.004, 0.11, 0.22, 626, 464);
      tumble(0.065, 0.082, 3, 0.32, 402, 3300);
      break;
    case 'wood-hit':
      for (const [at, hz, volume] of [
        [0, 155, 0.54],
        [0.002, 334, 0.29],
        [0.008, 794, 0.13],
      ]) {
        ring(at, 0.23, volume, hz, hz * 0.89);
      }
      grit(0, 0.058, 0.85, 440, 3600);
      break;
    case 'steel-hit':
      grit(0, 0.053, 0.69, 340, 3900);
      for (const [hz, decay, volume] of [
        [215, 0.48, 0.42],
        [559, 0.63, 0.24],
        [1126, 0.4, 0.16],
        [1893, 0.19, 0.1],
      ]) {
        ring(0.002, decay, volume, hz);
      }
      break;
    case 'glass-hit':
      grit(0, 0.035, 0.43, 1100, 6500);
      ring(0.002, 0.38, 0.28, 1151);
      ring(0.004, 0.31, 0.19, 2673);
      ring(0.005, 0.22, 0.09, 4784);
      break;
    case 'stone':
      ring(0, 0.32, 0.54, 144, 63);
      grit(0, 0.39, 1.3, 95, 3300, 0.003, 660);
      grit(0.047, 0.18, 0.59, 310, 1940);
      tumble(0.077, 0.17, 5, 0.68, 400, 3000);
      break;
    case 'wood':
      grit(0, 0.12, 0.91, 900, 6400, 0.001, 1800);
      for (const [at, hz, vol] of [
        [0.006, 176, 0.51],
        [0.023, 469, 0.39],
        [0.067, 292, 0.26],
      ]) {
        grit(at, 0.091, vol * 1.6, 570, 4400);
        ring(at, 0.18, vol * 0.65, hz, hz * 0.81);
      }
      tumble(0.142, 0.12, 4, 0.32, 320, 3800);
      break;
    case 'glass':
      grit(0, 0.12, 0.93, 1450, 9800, 0.001, 3300);
      for (const [at, hz, vol] of [
        [0.002, 1750, 0.24],
        [0.021, 3420, 0.15],
        [0.072, 2200, 0.18],
        [0.129, 4100, 0.1],
        [0.24, 2620, 0.1],
        [0.39, 3260, 0.065],
      ]) {
        const f = hz * variation(0.07);
        ring(at, 0.43, vol, f, f * 0.997);
        ring(at, 0.18, vol * 0.47, f * 1.62);
      }
      break;
    case 'steel':
      ring(0, 0.58, 0.37, 251, 165, 0.015);
      ring(0.004, 0.72, 0.23, 726, 497, 0.029);
      ring(0.007, 0.47, 0.16, 1178, 849, 0.035);
      grit(0.021, 0.24, 0.76, 420, 3200, 0.032);
      grit(0.12, 0.047, 0.76, 1400, 5800);
      ring(0.123, 0.73, 0.22, 605, 600);
      ring(0.123, 0.43, 0.12, 1618);
      break;
    case 'burnout':
      grit(0, 0.42, 0.56, 350, 4400, 0.042, 520);
      tumble(0.035, 0.086, 4, 0.27, 318, 3920);
      break;
    case 'stone-dust':
      grit(0.005, 0.32, 0.75, 170, 2460, 0.014, 510);
      tumble(0.018, 0.091, 5, 0.29, 380, 3050);
      break;
    case 'explosion':
    case 'barrel':
      ring(0.004, 0.63, 0.91, sound === 'barrel' ? 144 : 122, 34);
      ring(0.039, 0.59, 0.26, 96, 48, 0.013);
      grit(0, 0.105, 1.28, 890, 7800, 0.001, 2200);
      grit(0.01, 0.96, 1.79, 28, 1850, 0.018, 220);
      grit(0.095, 0.57, 0.59, 95, 1420, 0.037, 440);
      if (sound === 'barrel') {
        cord(0.058, 192, 0.34, 0.21);
        tumble(0.101, 0.155, 5, 0.65, 308, 4200);
      } else tumble(0.208, 0.2, 5, 0.51, 355, 2900);
      break;
    case 'implosion': {
      // Shrinking harmonic intervals and a rising envelope lead into the instant of collapse.
      const duration = Math.round(0.36 * RATE);
      let phase = 0, overtone = 0;
      for (let i = 0; i < duration; i++) {
        const t = i / duration;
        const hz = 83 + 290 * t * t;
        phase += 2 * Math.PI * hz / RATE;
        overtone += 2 * Math.PI * hz * (2.24 - 0.24 * t) / RATE;
        const gain = 0.4 * t * (1 - Math.max(0, (t - 0.95) / 0.05));
        data[i] += gain * (Math.sin(phase) + 0.28 * Math.sin(overtone));
      }
      grit(0.347, 0.06, 0.67, 1200, 6600, 0.002, 1900);
      ring(0.35, 0.42, 0.49, 165, 49);
      ring(0.353, 0.36, 0.27, 1120, 954);
      break;
    }
    case 'fireburst':
      grit(0, 0.56, 1.05, 170, 4800, 0.026, 580);
      ring(0.012, 0.26, 0.3, 296, 108);
      grit(0.14, 0.7, 0.62, 690, 6900, 0.08, 1800);
      break;
    case 'crackle':
      grit(0, 0.8, 0.28, 140, 1400, 0.065, 680);
      for (const at of [0.06, 0.22, 0.29, 0.51, 0.68]) {
        grit(at * variation(0.12), 0.03, 0.32 * variation(0.4), 1300, 6500);
      }
      break;
    case 'ignite':
      grit(0, 0.61, 0.9, 190, 3150, 0.056, 1150);
      for (const at of [0.07, 0.19, 0.39, 0.55, 0.81, 1.08]) {
        grit(at * variation(0.07), 0.05 * variation(0.21), 0.5 * variation(0.3), 820, 5700);
      }
      break;
    case 'extinguish':
      grit(0, 0.43, 0.91, 860, 6900, 0.028, 1600);
      grit(0.102, 0.24, 0.27, 500, 3300, 0.032, 1100);
      break;
    case 'faint':
      ring(0, 0.17, 0.26, 555, 690, 0.012);
      ring(0.088, 0.36, 0.34, 484, 184, 0.015);
      break;
    case 'clear':
      for (const [at, hz] of [
        [0, 392],
        [0.13, 494],
        [0.27, 587],
        [0.46, 784],
      ]) {
        ring(at, 0.74, 0.36, hz, hz, 0.012);
        ring(at, 0.42, 0.12, 2 * hz, 2 * hz, 0.014);
        ring(at, 0.21, 0.08, 2.99 * hz, 3 * hz);
      }
      break;
  }
  return data;
}

function effect({ type, material }) {
  if (type === 'fracture') return materials.has(material) ? material : 'stone';
  if (type === 'impact' || type === 'damage') {
    if (materials.has(material)) return material + '-hit';
    return material === 'earth' ? 'earth-hit' : 'impact';
  }
  if (type === 'explosion' && material === 'barrel') return 'barrel';
  return Object.hasOwn(cues, type) ? type : null;
}

export function createAudio() {
  let enabled = true,
    context,
    master,
    mix,
    preparation;
  const samples = new Map(),
    nextTime = new Map(),
    active = new Map();

  // Standalone AudioBuffers can be filled before the first user gesture.
  // Older browsers retain PCM and copy it into a playback buffer on first use.
  function sampleFor(sound, variant) {
    let bank = samples.get(sound);
    if (!bank) {
      bank = [];
      samples.set(sound, bank);
    }
    let sample = bank[variant];
    if (!sample) {
      sample = synthesize(sound);
      bank[variant] = sample;
    }
    if (sample instanceof Float32Array) {
      let buffer;
      if (context) buffer = context.createBuffer(1, sample.length, RATE);
      else if (globalThis.AudioBuffer) {
        try {
          buffer = new AudioBuffer({ length: sample.length, sampleRate: RATE, numberOfChannels: 1 });
        } catch {
          /* The cached PCM also works on devices without this constructor. */
        }
      }
      if (buffer) {
        buffer.getChannelData(0).set(sample);
        bank[variant] = buffer;
        return buffer;
      }
    }
    return sample;
  }

  function prepare() {
    if (!preparation) {
      preparation = (async () => {
        let deadline = performance.now() + 6;
        for (const sound of Object.keys(cues)) {
          const variants = materials.has(sound) ? 3 : 1;
          for (let i = 0; i < variants; i++) {
            sampleFor(sound, i);
            if (performance.now() >= deadline) {
              await new Promise((resolve) => setTimeout(resolve, 0));
              deadline = performance.now() + 6;
            }
          }
        }
      })();
    }
    return preparation;
  }

  function unlock() {
    if (!enabled) return;
    try {
      if (!context) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Context) return;
        const device = new Context();
        const bus = device.createGain(),
          output = device.createGain(),
          limiter = device.createDynamicsCompressor();
        output.gain.value = 0.55;
        limiter.threshold.value = -11;
        limiter.knee.value = 8;
        limiter.ratio.value = 6;
        limiter.attack.value = 0.004;
        limiter.release.value = 0.18;
        bus.connect(limiter).connect(output).connect(device.destination);
        // Short, dark valley reflections preserve the direct hit on each side.
        for (const [delay, amount, side] of [
          [0.079, 0.115, -0.58],
          [0.146, 0.066, 0.63],
        ]) {
          const echo = device.createDelay(),
            air = device.createBiquadFilter(),
            send = device.createGain();
          echo.delayTime.value = delay;
          air.frequency.value = 1820;
          send.gain.value = amount;
          bus.connect(echo).connect(air).connect(send);
          const panner = device.createStereoPanner?.();
          if (panner) {
            panner.pan.value = side;
            send.connect(panner).connect(limiter);
          } else send.connect(limiter);
        }
        context = device;
        mix = bus;
        master = output;
      }
      if (context.state !== 'running') context.resume()?.catch(() => {});
    } catch {
      /* Sound is optional when a device is unavailable. */
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!master) return;
    const now = context.currentTime;
    master.gain.setTargetAtTime(enabled ? 0.55 : 0, now, 0.008);
    if (!enabled) {
      for (const source of active.keys()) source.stop(now + 0.025);
      nextTime.clear();
    }
  }

  let nextFireCheck = 0;
  function play(events, sim, view) {
    if (!enabled || !context || context.state === 'closed' || context.state === 'interrupted') return;
    const now = context.currentTime;
    let crackle;
    if (sim && now >= nextFireCheck) {
      let sumX = 0,
        pieces = 0;
      for (const body of sim.entities.values()) {
        if (body.burning) {
          sumX += body.x;
          pieces++;
        }
      }
      nextFireCheck = now + (pieces ? 0.54 + Math.random() * 0.26 : 0.35);
      if (pieces) crackle = { type: 'crackle', x: sumX / pieces, strength: Math.min(0.75, 0.08 + pieces * 0.1) };
    }
    if (!events?.length && !crackle) return;
    const selected = new Map();
    const left = view?.x ?? 0;
    const width = view?.width ?? 1200;
    function consider(event) {
      const sound = effect(event);
      if (!sound) return;
      const isContact = event.type === 'impact' || event.type === 'damage' || event.type === 'fracture' ||
        event.type === 'burnout' || event.type === 'stone-dust';
      const offset = sound === 'clear' ? 0 : (2 * ((event.x ?? left + width / 2) - left)) / width - 1;
      const pan = clamp(offset * 0.94, -0.9, 0.9);
      // Adjacent blocks share their loudest hit. Separate parts of a collapse
      // can still sound simultaneously on opposite sides of the listener.
      const key = isContact ? sound + '/' + Math.round(pan * 1.4) : sound;
      if ((nextTime.get(key) || 0) > now) return;
      const strength = clamp(event.strength ?? 0.6, 0, 1);
      let gain = 0.28 + strength * 0.64;
      let pitch = 1.055 * (1 - 0.11 * strength);
      if (isContact) {
        const size = clamp(Math.sqrt((event.size ?? 24) / 36), 0.34, 1.65);
        const severity = event.type === 'damage' ? 0.72 * (event.damage ?? strength) + 0.28 * strength : strength;
        gain = Math.min(1.45, (0.025 + 0.96 * severity ** 1.3) * size);
        pitch = clamp(1.12 / Math.sqrt(size) - 0.12 * severity, 0.64, 1.65);
      } else if (sound === 'launch' || event.type === 'explosion') {
        const size = sound === 'launch' ? (event.size ?? 22) / 22 : (event.radius ?? 125) / 125;
        gain *= Math.sqrt(size);
        pitch /= size ** 0.42;
      }
      gain /= 1 + Math.max(0, Math.abs(offset) - 1) * 0.48;
      if (!selected.has(key) || selected.get(key).gain < gain)
        selected.set(key, { sound, event, gain, pitch, pan });
    }
    if (crackle) consider(crackle);
    for (const event of events ?? []) consider(event);
    const ordered = [...selected].sort(([, a], [, b]) => cues[b.sound][2] - cues[a.sound][2] || b.gain - a.gain);
    for (const [key, voice] of ordered) {
      const { sound, event } = voice;
      const [, cooldown, priority] = cues[sound];
      if (active.size >= 10 && priority < 2) continue;
      if (active.size >= 12) {
        const quiet = [...active].find(([, voice]) => voice.priority < priority);
        if (!quiet) continue;
        const [old, voice] = quiet;
        voice.gain.gain.setTargetAtTime(0, now, 0.004);
        old.stop(now + 0.018);
        active.delete(old);
      }
      const variant = materials.has(sound) ? Math.floor(Math.random() * 3) : 0;
      const source = context.createBufferSource();
      source.buffer = sampleFor(sound, variant);
      source.playbackRate.value = sound === 'clear' ? 1 : voice.pitch * variation(0.04);
      const gain = context.createGain();
      gain.gain.value = voice.gain;
      source.connect(gain);
      const pan = context.createStereoPanner?.();
      if (pan) {
        const start = voice.pan;
        pan.pan.setValueAtTime(start, now);
        if (sound === 'launch') pan.pan.linearRampToValueAtTime(Math.min(0.9, start + 0.48), now + 0.38);
        gain.connect(pan).connect(mix);
      } else gain.connect(mix);
      active.set(source, { priority, gain });
      source.onended = () => {
        active.delete(source);
        source.disconnect();
        gain.disconnect();
        pan?.disconnect();
      };
      nextTime.set(key, now + cooldown);
      // The leading impact stays sharp; the secondary fracture follows just
      // behind it, even if both events arrived in the same simulation tick.
      source.start(now + (event.type === 'fracture' && ordered.length > 1 ? 0.018 + Math.random() * 0.012 : 0));
    }
  }
  return { prepare, unlock, setEnabled, play };
}
