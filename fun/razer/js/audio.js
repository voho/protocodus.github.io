// A four-cylinder combustion voice with load, gearing, intake and road layers.
// Everything is synthesized locally; no streaming audio or sample dependencies.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const GEAR_SPEEDS = [55, 90, 130, 175, 215, 265]; // km/h at 7000 rpm

export function createEngineState() {
  let rpm = 950, gear = 1, shiftTime = 0, previousThrottle = 0, burbleCooldown = 0;
  return {
    get rpm() { return rpm; }, get gear() { return gear; },
    update(car, throttle, dt) {
      dt = clamp(dt, 0, .08); throttle = clamp(throttle, 0, 1);
      const speed = Math.abs(car?.speed || 0) * 3.6, reverse = (car?.speed || 0) < -.5;
      let shifted = false;
      shiftTime = Math.max(0, shiftTime - dt); burbleCooldown = Math.max(0, burbleCooldown - dt);
      if (speed < 3) gear = 1;
      const drivenRpm = speed / (reverse ? 40 : GEAR_SPEEDS[gear - 1]) * 7000;
      if (!reverse && !car?.airborne && shiftTime === 0) {
        if (drivenRpm > 6550 && gear < 6) { gear++; shifted = true; }
        else if (gear > 1 && drivenRpm < 3100) { gear--; shifted = true; }
        if (shifted) shiftTime = .16;
      }
      const roadRpm = speed / (reverse ? 40 : GEAR_SPEEDS[gear - 1]) * 7000;
      const freeRev = car?.airborne ? throttle * 6800 + 950 : 950 + throttle * 1450;
      const target = clamp(Math.max(freeRev, roadRpm + throttle * 160), 850, 7400);
      rpm += (target - rpm) * (1 - Math.exp(-dt / (target > rpm ? .13 : .19)));
      const burble = previousThrottle > .55 && throttle < .12 && rpm > 3200 && burbleCooldown === 0;
      if (burble) burbleCooldown = .65;
      previousThrottle = throttle;
      return { rpm, gear: reverse ? -1 : speed < 2 ? 0 : gear, shifted, burble,
        load: throttle * (shiftTime > 0 ? .23 : 1), shifting: shiftTime > 0,
        limiter: rpm > 7100, speed };
    },
  };
}

function combustionBuffer(context) {
  const duration = .3, buffer = context.createBuffer(1, Math.round(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0), cylinders = [1, .88, .95, .9, .98, .91, 1, .87];
  // Eight firing pulses across four crank revolutions, with a short pressure
  // front and resonating exhaust tail. The buffer repeats at 800 rpm.
  for (let i = 0; i < samples.length; i++) {
    const phase = i / samples.length * 8, cycle = Math.floor(phase), p = phase - cycle;
    const pressure = Math.exp(-p * 25) - .32 * Math.exp(-p * 5);
    const tail = Math.sin(p * Math.PI * 6.2) * Math.exp(-p * 7) * .42;
    samples[i] = (pressure + tail) * cylinders[cycle] * .8;
  }
  const mean = samples.reduce((sum, x) => sum + x, 0) / samples.length;
  for (let i = 0; i < samples.length; i++) samples[i] -= mean;
  return buffer;
}

export function createAudio({ contextFactory } = {}) {
  const engineState = createEngineState();
  let context, master, exhaust, exhaustGain, exhaustFilter, intake, intakeGain, intakeFilter;
  let turbo, turboGain, tireGain, tireFilter, roadGain, roadFilter, windGain, noiseBuffer;
  let muted = false, running = false, telemetry = { rpm: 950, gear: 0 };
  try { muted = localStorage.getItem('razer-muted') === 'true'; } catch {}
  function start() {
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!contextFactory && !AudioContext) return;
      context = contextFactory ? contextFactory() : new AudioContext();
      master = context.createGain(); master.gain.value = muted ? 0 : .48;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -13; compressor.knee.value = 16; compressor.ratio.value = 3;
      compressor.attack.value = .006; compressor.release.value = .16;
      master.connect(compressor); compressor.connect(context.destination);

      exhaust = context.createBufferSource(); exhaust.buffer = combustionBuffer(context); exhaust.loop = true;
      const dcFilter = context.createBiquadFilter(); dcFilter.type = 'highpass'; dcFilter.frequency.value = 24;
      exhaustFilter = context.createBiquadFilter(); exhaustFilter.type = 'lowpass'; exhaustFilter.frequency.value = 600; exhaustFilter.Q.value = .65;
      exhaustGain = context.createGain(); exhaustGain.gain.value = 0;
      exhaust.connect(dcFilter); dcFilter.connect(exhaustFilter); exhaustFilter.connect(exhaustGain); exhaustGain.connect(master); exhaust.start();
      // Slight combustion irregularity keeps steady RPM from sounding like an
      // unchanging oscillator. This modulates cents, not engine volume.
      const flutter = context.createOscillator(), flutterDepth = context.createGain();
      flutter.frequency.value = 13.7; flutterDepth.gain.value = 9;
      flutter.connect(flutterDepth); flutterDepth.connect(exhaust.detune); flutter.start();

      intake = context.createOscillator();
      const real = new Float32Array([0, 1, .46, .25, .15, .10, .055, .03]);
      const imaginary = new Float32Array(real.length);
      intake.setPeriodicWave(context.createPeriodicWave(real, imaginary));
      intakeFilter = context.createBiquadFilter(); intakeFilter.type = 'bandpass'; intakeFilter.frequency.value = 650; intakeFilter.Q.value = .65;
      intakeGain = context.createGain(); intakeGain.gain.value = 0;
      intake.connect(intakeFilter); intakeFilter.connect(intakeGain); intakeGain.connect(master); intake.start();
      turbo = context.createOscillator(); turbo.type = 'sine'; turboGain = context.createGain(); turboGain.gain.value = 0;
      turbo.connect(turboGain); turboGain.connect(master); turbo.start();

      noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = noiseBuffer.getChannelData(0); let seed = 71471;
      for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
      function noise(type, frequency, q = .7) {
        const source = context.createBufferSource(); source.buffer = noiseBuffer; source.loop = true;
        const filter = context.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
        const gain = context.createGain(); gain.gain.value = 0;
        source.connect(filter); filter.connect(gain); gain.connect(master); source.start();
        return [gain, filter];
      }
      [tireGain, tireFilter] = noise('bandpass', 1700, 1.8);
      [roadGain, roadFilter] = noise('lowpass', 850);
      [windGain] = noise('lowpass', 430);
    }
    if (context?.state === 'suspended' && !context.startRendering) context.resume().catch(() => {});
  }
  function burst(type, strength = 1) {
    if (!context || muted || !noiseBuffer) return;
    const t = context.currentTime, impact = type === 'collision' || type === 'land';
    const duration = impact ? .12 + strength * .14 : type === 'shift' ? .055 : .10;
    const source = context.createBufferSource(); source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.setValueAtTime(impact ? 420 + strength * 1100 : type === 'shift' ? 1100 : 240, t);
    filter.frequency.exponentialRampToValueAtTime(55, t + duration);
    const gain = context.createGain(); gain.gain.setValueAtTime(.001, t);
    gain.gain.exponentialRampToValueAtTime((impact ? .35 : .16) * clamp(strength, .1, 1.5), t + .006);
    gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    source.connect(filter); filter.connect(gain); gain.connect(master); source.start(t); source.stop(t + duration + .015);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  function cue(type, strength = 1) {
    if (!context || muted) return;
    if (type === 'collision' || type === 'land') { burst(type, clamp(strength, .15, 1.5)); return; }
    const notes = { count: [440, 440, .11], go: [660, 880, .32], boost: [260, 1100, .4], lap: [600, 900, .24], finish: [523, 1046, .8], recover: [210, 330, .2] };
    if (!notes[type]) return;
    const t = context.currentTime, oscillator = context.createOscillator(), gain = context.createGain();
    const [from, to, duration] = notes[type]; oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(from, t); oscillator.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(.13, t + .01); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    oscillator.connect(gain); gain.connect(master); oscillator.start(t); oscillator.stop(t + duration + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  return {
    start, cue,
    get muted() { return muted; },
    get telemetry() { return telemetry; },
    toggle() { muted = !muted; if (master) master.gain.setTargetAtTime(muted ? 0 : .48, context.currentTime, .04); try { localStorage.setItem('razer-muted', muted); } catch {} return muted; },
    update(car, active, throttle = 0, dt = 1 / 60) {
      if (active) telemetry = engineState.update(car, throttle, dt);
      if (!context) return;
      const t = context.currentTime, { rpm, load = 0, shifted, burble, limiter } = telemetry;
      const speed = Math.abs(car?.speed || 0), normalized = clamp((rpm - 950) / 6300, 0, 1);
      if (active && running && shifted) burst('shift', .65);
      if (active && running && burble) burst('burble', .6 + normalized * .3);
      running = active;
      const target = (parameter, value, smooth = .065) => parameter.setTargetAtTime(value, t, smooth);
      target(exhaust.playbackRate, rpm / 800, .025);
      const limiterCut = limiter && Math.sin(t * 75) > .1 ? .4 : 1;
      target(exhaustGain.gain, active ? (.65 + load * .48 + normalized * .18) * limiterCut : 0, active ? .035 : .025);
      target(exhaustFilter.frequency, 260 + rpm * .14 + load * 1450);
      target(intake.frequency, rpm / 30, .025);
      target(intakeFilter.frequency, 420 + rpm * .10 + load * 700);
      target(intakeGain.gain, active ? (.045 + load * .24) * normalized * limiterCut : 0);
      target(turbo.frequency, 600 + rpm * .36 + load * 250, .18);
      target(turboGain.gain, active ? normalized * load * (car?.boost > 0 ? .045 : .012) : 0, .14);
      const grounded = active && !car?.airborne && !car?.inWater;
      const loose = ['gravel', 'dirt', 'sand', 'grass', 'rock'].includes(car?.surface);
      const wheels = car?.wheels?.filter(wheel => wheel.contact) || [];
      const slip = wheels.length ? wheels.reduce((sum, wheel) => sum + Math.abs(wheel.slip || 0), 0) / wheels.length : 0;
      target(tireFilter.frequency, loose ? 750 : 1650 + normalized * 300);
      target(tireGain.gain, grounded && speed > 6 ? Math.min(.25, (car?.drift ? .19 : 0) + slip * .015) * (loose ? .55 : 1) : 0);
      target(roadFilter.frequency, car?.inWater ? 420 : loose ? 1350 : 550);
      target(roadGain.gain, active && !car?.airborne ? Math.min(.20, speed / 380) * (car?.inWater ? 1.8 : loose ? 1.3 : .35) : 0);
      target(windGain.gain, active ? Math.min(.24, (speed / 70) ** 1.7 * .18) : 0, .12);
    },
  };
}
