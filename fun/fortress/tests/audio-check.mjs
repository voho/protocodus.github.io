import assert from 'node:assert/strict';

// Render the game's actual Web Audio graph in Chromium without sending
// anything to the speakers. Stereo RMS also includes the valley reflections.
export async function checkFortressAudio(page) {
  const sounds = await page.evaluate(async () => {
    const { createAudio } = await import('./audio.js');
    const { stormStrikeTime } = await import('./weather-effects.js');
    await createAudio().prepare();
    const liveContext = window.AudioContext;
    let offline, sources, frames;
    window.AudioContext = class extends OfflineAudioContext {
      constructor() {
        super(2, frames, 32000);
        offline = this;
        sources = [];
      }
      get state() {
        return 'running';
      }
      get currentTime() {
        return this.scheduledTime ?? super.currentTime;
      }
      createBufferSource() {
        const node = super.createBufferSource();
        sources.push(node);
        return node;
      }
    };
    async function render(properties, weather) {
      frames = properties.type === 'explosion' ? 48000 : 32000;
      const audio = createAudio();
      audio.unlock();
      const event = {
        type: 'damage', material: 'wood', size: 28, damage: 0.6, strength: 0.65, x: 900, ...properties,
      };
      if (weather) {
        const sim = { level: { weather: weather.condition }, wind: weather.wind, seed: weather.seed ?? 2, entities: new Map() };
        const strike = stormStrikeTime(sim.seed, 0);
        const clock = weather.strike ? strike + 0.95 + 1.7 * (strike % 1) : 0;
        audio.play([], sim, { x: 700, width: 400 }, clock);
        if (weather.pause) {
          offline.scheduledTime = 0.3;
          audio.pauseWeather();
        }
      } else audio.play([event], null, { x: 700, width: 400 });
      const wave = await offline.startRendering();
      const rms = [], right = wave.getChannelData(1);
      let energy = 0, change = 0, tail = 0, lateEnergy = 0, releaseEnergy = 0, stereoDifference = 0;
      for (let channel = 0; channel < wave.numberOfChannels; channel++) {
        const samples = wave.getChannelData(channel);
        let sum = 0;
        for (let i = 1; i < samples.length; i++) {
          sum += samples[i] ** 2;
          change += (samples[i] - samples[i - 1]) ** 2;
          if (i > wave.sampleRate * 0.22) tail += samples[i] ** 2;
          if (i > wave.sampleRate * 0.72) lateEnergy += samples[i] ** 2;
          if (i > wave.sampleRate * 1.15) releaseEnergy += samples[i] ** 2;
          if (!channel) stereoDifference += (samples[i] - right[i]) ** 2;
        }
        rms.push(Math.sqrt(sum / samples.length));
        energy += sum;
      }
      const recorded = sources.filter((source) => source.buffer?.numberOfChannels === 2);
      const loops = recorded.filter((source) => source.loop);
      const seams = loops.map(({ buffer, loopStart, loopEnd }) => {
        let jump = 0, derivative = 0;
        for (let c = 0; c < 2; c++) {
          const data = buffer.getChannelData(c);
          const a = Math.round(loopStart * buffer.sampleRate), b = Math.round(loopEnd * buffer.sampleRate);
          jump += (data[a] - data[b - 1]) ** 2;
          for (let i = 0; i < 1024; i++) derivative += (data[a + i + 1] - data[a + i]) ** 2 / 1024;
        }
        return Math.sqrt(jump / derivative);
      });
      return { rms, brightness: Math.sqrt(change / energy), tail: tail / energy, lateEnergy, releaseEnergy, width: stereoDifference / energy,
        seams, loops: loops.map((source) => source.loopEnd - source.loopStart),
        claps: recorded.filter((source) => !source.loop).map((source) => source.buffer.duration) };
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
        storm: await render({}, { condition: 'storm', wind: 5 }),
        strikeA: await render({}, { condition: 'storm', wind: 5, strike: true, seed: 2 }),
        strikeB: await render({}, { condition: 'storm', wind: 5, strike: true, seed: 3 }),
        strikeC: await render({}, { condition: 'storm', wind: 5, strike: true, seed: 4 }),
        gust: await render({}, { condition: 'clear', wind: 75 }),
        paused: await render({}, { condition: 'storm', wind: 70, strike: true, pause: true }),
        blast: await render({ type: 'explosion' }),
        magicRelease: await render({ type: 'explosion', material: 'magic-bomb' }),
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
  assert.deepEqual(sounds.rain.loops, [22]);
  assert.deepEqual(sounds.storm.loops, [24]);
  assert.ok(sounds.rain.width > 0.2 && sounds.storm.width > 0.2, 'Drops occupy a broad stereo field');
  assert.ok(sounds.rain.seams[0] < 4 && sounds.storm.seams[0] < 4, 'Loop joins stay within the normal sample-to-sample variation');
  assert.deepEqual(sounds.storm.claps, [], 'Thunder waits for lightning');
  const rolls = [sounds.strikeA, sounds.strikeB, sounds.strikeC].map((sound) => sound.claps[0]);
  assert.ok(rolls.every((seconds) => seconds > 8) && new Set(rolls).size === 3, 'Strikes use three separate field recordings');
  assert.ok(sounds.paused.rms[0] > 0.001 && sounds.paused.lateEnergy < sounds.storm.lateEnergy * 0.0001,
    'Pausing fades active rain, wind and thunder');
  assert.ok(sounds.magicRelease.releaseEnergy > sounds.blast.releaseEnergy * 2 && sounds.magicRelease.releaseEnergy > 0.0001,
    'The magic release still rings after the ordinary blast has decayed');
  return sounds;
}
