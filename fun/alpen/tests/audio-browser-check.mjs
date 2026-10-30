// From the running game's console:
// await (await import('./tests/audio-browser-check.mjs')).runAudioCheck()
// Render the production graph offline in a private iframe. No speakers,
// player settings, live audio graph or main-page globals are touched.
import { RIDER } from '../js/config.js';

export async function runAudioCheck() {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const frame = document.createElement('iframe');
  frame.hidden = true;
  const loaded = new Promise(resolve => { frame.onload = resolve; });
  frame.srcdoc = '<!doctype html><title>Alpen offline audio check</title>';
  document.body.appendChild(frame);
  await loaded;
  try {
    const scope = frame.contentWindow;
    const audioUrl = new URL('../js/audio.js', import.meta.url).href;
    const { createAudio } = await scope.eval(`import(${JSON.stringify(audioUrl)})`);
    Object.defineProperty(scope, 'localStorage', {
      value: { getItem: () => null, setItem() {} },
    });
    Object.defineProperty(scope, 'performance', { value: { now: () => 100 } });

    async function render({ speed = 30, grounded = true, lean = 0, rock = 0, mono = false } = {}) {
      let context;
      let seed = 104729;
      scope.Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      scope.AudioContext = function () {
        context = new scope.OfflineAudioContext(2, 48000, 48000);
        if (mono) context.createStereoPanner = undefined;
        // Only the lifecycle gate is adapted. Every source, filter, panner,
        // automation curve, compressor and rendered sample is native WebAudio.
        return new Proxy(context, {
          get(target, key) {
            if (key === 'state') return 'running';
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      };
      const audio = createAudio();
      audio.start();
      audio.ambience(speed, 7, grounded, 0, 0.9, 0,
        { rock, ice: 0, powder: 0 }, 0, lean);
      const buffer = await context.startRendering();
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      const energy = [0, 0];
      let derivative = 0, peak = 0;
      const start = 24000, end = 45600;
      for (let channel = 0; channel < 2; channel++) {
        const data = channels[channel];
        for (let i = 0; i < data.length; i++) {
          assert(Number.isFinite(data[i]), 'rendered audio must be finite');
          peak = Math.max(peak, Math.abs(data[i]));
          if (i >= start && i < end) {
            energy[channel] += data[i] * data[i];
            derivative += (data[i] - data[i - 1]) ** 2;
          }
        }
      }
      const total = energy[0] + energy[1];
      assert(peak < 1, 'the authored riding mix must not clip');
      return {
        channels,
        leftRms: Math.sqrt(energy[0] / (end - start)),
        rightRms: Math.sqrt(energy[1] / (end - start)),
        brightness: Math.sqrt(derivative / total),
        peak,
      };
    }

    const centre = await render();
    const mono = await render({ mono: true });
    let centreError = 0;
    for (let channel = 0; channel < 2; channel++) {
      for (let i = 0; i < centre.channels[channel].length; i++) {
        centreError = Math.max(centreError,
          Math.abs(centre.channels[channel][i] - mono.channels[channel][i]));
      }
    }
    assert(centreError < 1e-5, `centre preserves the mono mix: ${centreError}`);

    const left = await render({ lean: RIDER.lean });
    const right = await render({ lean: -RIDER.lean });
    assert(left.leftRms > left.rightRms * 1.025,
      `left carve is audible on the left: ${left.leftRms} / ${left.rightRms}`);
    assert(right.rightRms > right.leftRms * 1.025,
      `right carve is audible on the right: ${right.leftRms} / ${right.rightRms}`);
    const air = await render({ grounded: false, lean: RIDER.lean });
    assert(Math.abs(air.leftRms - air.rightRms) < 1e-7, 'flight has centred wind and no edge');
    assert(air.leftRms + air.rightRms < centre.leftRms + centre.rightRms,
      'leaving the snow quietens the mix');
    const stopped = await render({ speed: 0, rock: 1, lean: RIDER.lean });
    const idle = await render({ speed: 0 });
    assert(Math.abs(stopped.leftRms - idle.leftRms) < 1e-7,
      'stationary rock contact adds no scraping');
    const fast = await render({ speed: 42 });
    const flow = await render({ speed: 84 });
    assert(flow.brightness > fast.brightness * 1.01,
      'flow speed audibly brightens beyond the old ceiling');

    const compact = result => Object.fromEntries(
      ['leftRms', 'rightRms', 'brightness', 'peak'].map(key => [key, +result[key].toFixed(6)]));
    return {
      passed: true,
      sampleRate: 48000,
      centreError,
      centre: compact(centre), left: compact(left), right: compact(right),
      air: compact(air), stopped: compact(stopped),
      at42: compact(fast), at84: compact(flow),
    };
  } finally {
    frame.remove();
  }
}
