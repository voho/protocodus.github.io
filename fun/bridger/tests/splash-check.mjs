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
}
