import assert from 'node:assert/strict';

// Render the game's actual Web Audio graph in Chromium without sending
// anything to the speakers. Stereo RMS also includes the valley reflections.
export async function checkFortressAudio(page) {
  const sounds = await page.evaluate(async () => {
    const { createAudio } = await import('./audio.js');
    const liveContext = window.AudioContext;
    let offline;
    window.AudioContext = class extends OfflineAudioContext {
      constructor() {
        super(2, 32000, 32000);
        offline = this;
      }
      get state() {
        return 'running';
      }
    };
    async function render(properties, weather) {
      const audio = createAudio();
      audio.unlock();
      const event = {
        type: 'damage', material: 'wood', size: 28, damage: 0.6, strength: 0.65, x: 900, ...properties,
      };
      if (weather) {
        const sim = { level: { weather: weather.condition }, wind: weather.wind, seed: 2, entities: new Map() };
        audio.play([], sim, { x: 700, width: 400 }, 0);
        if (weather.pause) audio.pauseWeather();
      } else audio.play([event], null, { x: 700, width: 400 });
      const wave = await offline.startRendering();
      const rms = [];
      let energy = 0, change = 0, tail = 0;
      for (let channel = 0; channel < wave.numberOfChannels; channel++) {
        const samples = wave.getChannelData(channel);
        let sum = 0;
        for (let i = 1; i < samples.length; i++) {
          sum += samples[i] ** 2;
          change += (samples[i] - samples[i - 1]) ** 2;
          if (i > wave.sampleRate * 0.22) tail += samples[i] ** 2;
        }
        rms.push(Math.sqrt(sum / samples.length));
        energy += sum;
      }
      return { rms, brightness: Math.sqrt(change / energy), tail: tail / energy };
    }
    try {
      return {
        lightDamage: await render({ damage: 0.16 }),
        majorDamage: await render({ damage: 0.88 }),
        chip: await render({ size: 10 }),
        slab: await render({ size: 60 }),
        left: await render({ x: 750 }),
        right: await render({ x: 1050 }),
        wood: await render({ type: 'impact' }),
        steel: await render({ type: 'impact', material: 'steel' }),
        glass: await render({ type: 'impact', material: 'glass' }),
        stone: await render({ type: 'impact', material: 'stone' }),
        earth: await render({ type: 'impact', material: 'earth' }),
        rain: await render({}, { condition: 'rain', wind: 5 }),
        gust: await render({}, { condition: 'clear', wind: 75 }),
        paused: await render({}, { condition: 'rain', wind: 5, pause: true }),
      };
    } finally {
      window.AudioContext = liveContext;
    }
  });
  assert.ok(sounds.majorDamage.rms[0] > 2 * sounds.lightDamage.rms[0], 'Minor damage is quieter than major damage');
  assert.ok(sounds.slab.rms[0] > 1.6 * sounds.chip.rms[0], 'A larger damaged piece has more body');
  assert.ok(sounds.left.rms[0] > 2 * sounds.left.rms[1], 'A hit left of the camera plays on the left');
  assert.ok(sounds.right.rms[1] > 2 * sounds.right.rms[0], 'A hit right of the camera plays on the right');
  assert.ok(sounds.glass.brightness > 1.5 * sounds.wood.brightness, 'Glass rings brighter than a wooden knock');
  assert.ok(sounds.steel.tail > 2 * sounds.wood.tail, 'Steel rings longer than timber');
  assert.ok(sounds.stone.brightness > 1.25 * sounds.earth.brightness, 'Stone has a sharper contact than earth');
  assert.ok(sounds.rain.rms[0] > 0.001 && sounds.gust.rms[0] > 0.001);
  assert.ok(sounds.rain.brightness > 2 * sounds.gust.brightness, 'Rain and wind use distinct frequency bands');
  assert.ok(sounds.paused.rms[0] < sounds.rain.rms[0] * 0.1, 'Paused weather fades out');
}
