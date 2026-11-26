import assert from 'node:assert/strict';

// Exercise the ordinary mixer against Chromium's native audio graph, including
// decoding the bundled recording, without depending on a speaker or autoplay.
export async function checkSplash(page) {
  const render = (unavailable) => page.evaluate(async (unavailable) => {
    const { createSound } = await import('./js/sound.js');
    const NativeContext = window.AudioContext;
    const offline = new OfflineAudioContext(2, 48000 * 2, 48000);
    const decode = offline.decodeAudioData.bind(offline);
    const createSource = offline.createBufferSource.bind(offline);
    const decoded = [], starts = [];
    offline.decodeAudioData = async (...args) => {
      if (unavailable) throw new Error('Fixture cannot decode the recording');
      const buffer = await decode(...args);
      decoded.push(buffer);
      return buffer;
    };
    offline.createBufferSource = () => {
      const node = createSource(), start = node.start.bind(node);
      node.start = (...args) => {
        starts.push({ node, buffer: node.buffer, loop: node.loop });
        return start(...args);
      };
      return node;
    };
    try {
      window.AudioContext = function () { return offline; };
      const sound = createSound();
      if (!sound.enabled) sound.toggle();
      sound.unlock();
      await sound.prepareSplash();
      await sound.prepareSplash();
      const silentPreparation = starts.length === 0;
      sound.splash();
      sound.splash(12000);
      const shots = starts.filter(({ buffer }) => buffer === decoded[0]);
      const rendered = await offline.startRendering();
      return {
        decodes: decoded.length, silentPreparation, shots: shots.length,
        nodes: new Set(shots.map(({ node }) => node)).size,
        loops: starts.some(({ loop }) => loop),
        audible: rendered.getChannelData(0).some((v) => Math.abs(v) > 0.001),
      };
    } finally {
      window.AudioContext = NativeContext;
    }
  }, unavailable);
  const result = await render(false);
  assert.equal(result.decodes, 1, 'The splash recording is decoded once');
  assert.ok(result.silentPreparation, 'Preparing the splash is silent');
  assert.equal(result.shots, 2, 'Both impacts play the cached recording');
  assert.equal(result.nodes, 2, 'Each impact has a fresh one-shot source');
  assert.equal(result.loops, false, 'Splash sources do not loop');
  assert.ok(result.audible, 'The splash reaches the mixer output');
  const fallback = await render(true);
  assert.ok(fallback.audible && !fallback.loops, 'An unavailable recording still produces a finite splash');
  await checkDeparture(page);
}

async function checkDeparture(page) {
  const levels = await page.evaluate(async () => {
    const { createSound } = await import('./js/sound.js');
    const native = window.AudioContext;
    const saved = localStorage.getItem('bridger-sound');
    const rate = 24000, offline = new OfflineAudioContext(2, rate * 5, rate);
    const resume = offline.resume.bind(offline);
    offline.resume = async () => {}; // Only advance the test clock at each waypoint.
    const createSource = offline.createBufferSource.bind(offline);
    let starts = 0;
    offline.createBufferSource = () => {
      const source = createSource(), start = source.start.bind(source);
      source.start = (...args) => { if (source.loop) starts++; return start(...args); };
      return source;
    };
    try {
      window.AudioContext = function () { return offline; };
      localStorage.setItem('bridger-sound', 'on');
      const sound = createSound();
      const car = { id: 'car', axles: [{ x: 4, y: 0, beam: -1 }, { x: 1, y: 0, beam: -1 }] };
      const drive = (pan, gain) => sound.engine(true, car, pan, gain);
      drive(-0.7, 1);
      const waypoints = [
        [0.8, () => drive(0.7, 0.3)], [1.6, () => sound.engine(false)],
        [2.0, () => drive(0.7, 0.3)], [2.8, () => sound.toggle()],
        [3.1, () => { sound.toggle(); drive(0.85, 0.13); }],
        [3.9, () => drive(1, 0)], [4.4, () => drive(1, 0)],
      ].map(([time, update]) => [offline.suspend(time), update]);
      const result = offline.startRendering();
      for (const [pause, update] of waypoints) { await pause; update(); await resume(); }
      const recording = await result;
      const rms = (channel, start, end) => {
        const samples = recording.getChannelData(channel).subarray(start * rate, end * rate);
        return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
      };
      return { full: rms(0, 0.35, 0.75), right: rms(1, 1.15, 1.55), left: rms(0, 1.15, 1.55),
        paused: rms(1, 1.94, 1.99), resumed: rms(1, 2.4, 2.75), unmuted: rms(1, 3.53, 3.85),
        stopped: rms(1, 4.5, 4.9), starts };
    } finally {
      window.AudioContext = native;
      if (saved === null) localStorage.removeItem('bridger-sound'); else localStorage.setItem('bridger-sound', saved);
    }
  });
  assert.ok(levels.full > 0.03 && levels.right > 0.005 && levels.right < levels.full * 0.6, 'The motor stays audible and fades as it recedes');
  assert.ok(levels.right > levels.left * 2, 'The departing motor and tyre noise pan to the exit bank');
  assert.ok(levels.paused < 0.0005 && levels.resumed < levels.full * 0.6 && levels.unmuted < levels.resumed * 0.75,
    'Help and mute resume at the passing vehicle’s current distance');
  assert.ok(levels.stopped < 0.00001 && levels.starts === 6, 'The offscreen motor falls silent and starts no more looping sources');
}
