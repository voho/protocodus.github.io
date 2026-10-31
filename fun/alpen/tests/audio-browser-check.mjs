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
    let activeContext;
    Object.defineProperty(scope, 'performance', {
      value: { now: () => 100 + (activeContext?.currentTime || 0) * 1000 },
    });
    const start = 24000, end = 45600;

    async function render({ speed = 30, grounded = true, lean = 0, rock = 0, mono = false,
      tumbleSlide = 0, stopAt = null } = {}) {
      let context;
      let seed = 104729;
      scope.Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      scope.AudioContext = function () {
        context = new scope.OfflineAudioContext(2, 48000, 48000);
        activeContext = context;
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
      const ambience = (speed, bodySpeed) => audio.ambience(speed, 7, grounded, 0, 0.9, bodySpeed,
        { rock, ice: 0, powder: 0 }, 0, lean);
      ambience(speed, tumbleSlide);
      const suspended = stopAt === null ? null : context.suspend(stopAt);
      const rendering = context.startRendering();
      if (suspended) {
        await suspended;
        try { ambience(0, 0); } finally { await context.resume(); }
      }
      const buffer = await rendering;
      const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
      const energy = [0, 0];
      let derivative = 0, peak = 0;
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

    const differenceRms = (a, b) => {
      let energy = 0;
      for (let channel = 0; channel < 2; channel++) {
        for (let i = start; i < end; i++) energy += (a.channels[channel][i] - b.channels[channel][i]) ** 2;
      }
      return Math.sqrt(energy / (2 * (end - start)));
    };

    // OfflineAudioContext supplies the native source clocks and waveform.
    // Only the wall timer and context lifecycle are controlled: rendering
    // suspensions let us issue production pause/resume at precise times,
    // without waiting 350 ms or playing any sound through speakers.
    async function renderCue({ pause = true, rapid = false, fresh = false,
      fallback = false, interruptFade = false } = {}) {
      const originalSetTimeout = scope.setTimeout, originalClearTimeout = scope.clearTimeout;
      const timers = new Map();
      let nextTimer = 0, context, lifecycle = 'running';
      scope.setTimeout = (callback, delay) => {
        timers.set(++nextTimer, { callback, delay }); return nextTimer;
      };
      scope.clearTimeout = id => timers.delete(id);
      scope.AudioContext = function () {
        context = new scope.OfflineAudioContext(2, 48000, 48000);
        activeContext = context;
        if (fallback) {
          const gain = context.createGain.bind(context);
          context.createGain = () => {
            const node = gain(); node.gain.cancelAndHoldAtTime = undefined; return node;
          };
        }
        return new Proxy(context, {
          get(target, key) {
            if (key === 'state') return lifecycle;
            if (key === 'suspend') return async () => { lifecycle = 'suspended'; };
            if (key === 'resume') return async () => { lifecycle = 'running'; };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      };
      try {
        const audio = createAudio(); audio.start(); audio.cocoa();
        const quieting = pause ? context.suspend(.05) : null;
        const resuming = pause ? context.suspend(rapid || interruptFade ? .06 : .4) : null;
        const rendering = context.startRendering();
        let quietAt = null, resumeAt = null;
        if (pause) {
          await quieting;
          quietAt = context.currentTime; audio.quiet();
          assert(timers.size === 1 && [...timers.values()][0].delay === 350, 'production park keeps its 350 ms delay');
          await context.resume(); await resuming;
          resumeAt = context.currentTime;
          if (interruptFade) {
            lifecycle = 'interrupted';
            if (interruptFade === 'quiet') audio.quiet();
          } else if (!rapid) {
            [...timers.values()][0].callback(); await Promise.resolve();
            assert(lifecycle === 'suspended', 'the real parking callback suspends the lifecycle');
            // Wall time can now pass indefinitely; no audio-clock time passes.
          }
          audio.start();
          assert(lifecycle === 'running' && timers.size === 0, 'resume wakes the context and cancels parking');
          if (fresh) audio.perfectPop();
          await context.resume();
        }
        const buffer = await rendering;
        const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
        for (const data of channels) for (const sample of data) {
          assert(Number.isFinite(sample) && Math.abs(sample) < 1, 'one-shot rendering remains finite and unclipped');
        }
        return { channels, quietAt, resumeAt };
      } finally {
        scope.setTimeout = originalSetTimeout; scope.clearTimeout = originalClearTimeout;
      }
    }
    const cueRms = (cue, from, to) => {
      const first = Math.ceil(from * 48000), last = Math.floor(to * 48000);
      let energy = 0;
      for (const data of cue.channels) for (let i = first; i < last; i++) energy += data[i] ** 2;
      return Math.sqrt(energy / ((last - first) * 2));
    };

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

    // A fallen body can drag over snow while the board remains airborne.
    // Deterministic noise makes the added voice observable in actual samples,
    // separately from the unchanged wind at the same riding speed.
    const body = await render({ grounded: false, lean: RIDER.lean, tumbleSlide: 24 });
    const bodySignal = differenceRms(body, air);
    assert(body.leftRms > air.leftRms * 1.05,
      `body contact is audible above the same-speed flight mix: ${body.leftRms} / ${air.leftRms}`);
    assert(bodySignal > 1e-4, `body contact adds a rendered scraping waveform: ${bodySignal}`);
    for (let i = start; i < end; i++) {
      assert(Math.abs(body.channels[0][i] - body.channels[1][i]) < 1e-7,
        'body scraping stays centred even with a held carve lean');
    }
    const slowBody = await render({ grounded: false, lean: RIDER.lean, tumbleSlide: 1 });
    const slowBodySignal = differenceRms(slowBody, air);
    assert(slowBodySignal > 0 && slowBodySignal < bodySignal * 0.1,
      `slow body contact fades the rendered scrape: ${slowBodySignal} / ${bodySignal}`);
    // Exercise the release on the native audio clock; two initially identical
    // wind mixes stop at the same time, with body drag present in only one.
    const bodyStopped = await render({ grounded: false, tumbleSlide: 24, stopAt: 0.125 });
    const airStopped = await render({ grounded: false, stopAt: 0.125 });
    const stoppedBodySignal = differenceRms(bodyStopped, airStopped);
    assert(stoppedBodySignal < bodySignal * 0.002,
      `a stationary body adds no sustained scraping after release: ${stoppedBodySignal}`);

    const stopped = await render({ speed: 0, rock: 1, lean: RIDER.lean });
    const idle = await render({ speed: 0 });
    assert(Math.abs(stopped.leftRms - idle.leftRms) < 1e-7,
      'stationary rock contact adds no scraping');
    const fast = await render({ speed: 42 });
    const flow = await render({ speed: 84 });
    assert(flow.brightness > fast.brightness * 1.01,
      'flow speed audibly brightens beyond the old ceiling');

    const continuingCue = await renderCue({ pause: false });
    const retiredCue = await renderCue();
    const continuingTail = cueRms(continuingCue, .42, .72);
    const resumedTail = cueRms(retiredCue, .42, .72);
    assert(continuingTail > 1e-4, `the uninterrupted cue really has a long audible tail: ${continuingTail}`);
    assert(resumedTail < 1e-7, `parking then resuming cannot replay a stale one-shot tail: ${resumedTail}`);
    const fadingSignal = cueRms(retiredCue, retiredCue.quietAt + .012, retiredCue.quietAt + .020);
    const delayedSignal = cueRms(retiredCue, .11, .25);
    assert(fadingSignal > 1e-5, `an active cue receives a short audible fade: ${fadingSignal}`);
    assert(delayedSignal < 1e-7, `the fade ends and delayed notes never sound: ${delayedSignal}`);
    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < retiredCue.quietAt * 48000; i++) {
      assert(retiredCue.channels[channel][i] === continuingCue.channels[channel][i], 'retirement preserves the already rendered cue');
    }
    const rapidCue = await renderCue({ rapid: true });
    const rapidTail = cueRms(rapidCue, .11, .3);
    assert(rapidTail < 1e-7, `rapid resume does not revive the old fade: ${rapidTail}`);
    const freshCue = await renderCue({ rapid: true, fresh: true });
    const freshSignal = cueRms(freshCue, .1, .18);
    assert(freshSignal > 1e-4, `rapid resume still plays a fresh cue: ${freshSignal}`);
    const fallbackCue = await renderCue({ fallback: true });
    let fallbackError = 0;
    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < 48000; i++) {
      fallbackError = Math.max(fallbackError, Math.abs(fallbackCue.channels[channel][i] - retiredCue.channels[channel][i]));
    }
    assert(fallbackError < 1e-6, `fallback cancellation preserves the native held envelope: ${fallbackError}`);
    const interruptedCue = await renderCue({ interruptFade: 'quiet' });
    // The limiter has a short look-ahead delay; allow that already rendered
    // audio to leave, then no fragment of the interrupted fade may follow.
    const interruptedTail = cueRms(interruptedCue, .07, .085);
    assert(interruptedTail < 1e-7, `a frozen fade cannot survive the second quiet: ${interruptedTail}`);
    const directResumeCue = await renderCue({ interruptFade: 'resume' });
    const directResumeTail = cueRms(directResumeCue, .07, .085);
    assert(directResumeTail < 1e-7, `resuming a frozen fade directly cannot replay its remainder: ${directResumeTail}`);

    const compact = result => Object.fromEntries(
      ['leftRms', 'rightRms', 'brightness', 'peak'].map(key => [key, +result[key].toFixed(6)]));
    return {
      passed: true,
      sampleRate: 48000,
      centreError,
      centre: compact(centre), left: compact(left), right: compact(right),
      air: compact(air), stopped: compact(stopped),
      body: compact(body), slowBody: compact(slowBody), bodyStopped: compact(bodyStopped),
      bodySignal, slowBodySignal, stoppedBodySignal,
      at42: compact(fast), at84: compact(flow),
      oneShots: { continuingTail, resumedTail, fadingSignal, delayedSignal,
        rapidTail, freshSignal, fallbackError, interruptedTail, directResumeTail },
    };
  } finally {
    frame.remove();
  }
}
