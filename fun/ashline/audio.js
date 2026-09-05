// Original synthesized effects; the locally hosted CC0 soundtrack is credited in assets/audio/CREDITS.md.
export const SOUND_KINDS = ['select', 'order', 'error', 'buildStart', 'buildComplete', 'unitReady', 'rifle', 'scout', 'tank', 'artillery', 'explosion', 'delivery', 'victory', 'defeat', 'rocket'];
const durations = [.12, .18, .24, .5, .65, .48, .2, .24, .6, .85, 1, .4, 1.5, 1.5, .65];
const aliases = { confirm: 'order', build: 'buildStart', combat: 'rifle', turret: 'tank', rocketTower: 'rocket' };
const cooldowns = { rifle: .08, scout: .1, tank: .16, artillery: .24, rocket: .18, explosion: .16, delivery: .5 };

function createEffects(context) {
  const effects = new Map();
  let seed = 0x415348;
  for (const [index, kind] of SOUND_KINDS.entries()) {
    const buffer = context.createBuffer(1, Math.ceil(durations[index] * 24000), 24000);
    const samples = buffer.getChannelData(0);
    let rumble = 0, previousNoise = 0;
    for (let i = 0; i < samples.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const t = i / 24000, noise = (seed >>> 0) / 2147483648 - 1;
      rumble += .065 * (noise - rumble);
      const bright = noise - previousNoise; previousNoise = noise;
      const tone = (frequency, decay, delay = 0, sweep = 0) => t < delay ? 0 : Math.sin(2 * Math.PI * (frequency * (t - delay) + sweep * (t - delay) ** 2 / 2)) * Math.exp(-decay * (t - delay));
      const tail = decay => Math.exp(-decay * t);
      let sample;
      switch (kind) {
        case 'select': sample = .2 * tone(1100, 45) + .06 * bright * tail(90); break;
        case 'order': sample = .17 * tone(660, 35) + .15 * tone(990, 30, .055) + .035 * noise * tail(45); break;
        case 'error': sample = .2 * tone(190, 12, 0, -330) + .08 * tone(205, 16); break;
        case 'buildStart': sample = .38 * rumble * tail(8) + .18 * tone(115, 10, 0, 180) + .14 * noise * tail(65); break;
        case 'buildComplete': sample = .14 * tone(330, 7) + .14 * tone(440, 8, .12) + .12 * tone(660, 8, .24) + .05 * noise * tail(30); break;
        case 'unitReady': sample = .15 * tone(440, 12) + .13 * tone(587.3, 12, .085) + .12 * tone(880, 12, .17); break;
        case 'rifle': {
          const shot = t < .073 ? t : t - .073;
          sample = .48 * bright * Math.exp(-65 * shot) + .3 * rumble * Math.exp(-30 * shot) + .16 * Math.sin(shot * 1050) * Math.exp(-45 * shot);
          break;
        }
        case 'scout': sample = .32 * bright * tail(48) + .19 * tone(620, 24, 0, -1600) + .28 * rumble * tail(23); break;
        case 'tank': sample = .55 * rumble * tail(8) + .34 * tone(110, 11, 0, -100) + .28 * bright * tail(90) + .08 * tone(930, 25, .07); break;
        case 'artillery': sample = .74 * rumble * tail(5) + .3 * tone(85, 7, 0, -55) + .34 * bright * tail(65) + .12 * tone(1450, 18, .05); break;
        case 'rocket': sample = .22 * bright * tail(60) + .65 * rumble * tail(6) + .28 * noise * Math.min(1, t * 30) * tail(7) + .16 * tone(180, 9, 0, 780); break;
        case 'explosion': sample = .95 * rumble * tail(4.5) + .3 * tone(70, 7, 0, -28) + .38 * noise * tail(25); break;
        case 'delivery': sample = .1 * tone(440, 18) + .1 * tone(660, 16, .085) + .16 * rumble * tail(15) + .1 * noise * tail(60); break;
        case 'victory': sample = .13 * tone(261.63, 3) + .12 * tone(329.63, 3, .17) + .11 * tone(392, 3, .34) + .12 * tone(523.25, 3, .52); break;
        case 'defeat': sample = .16 * tone(220, 4) + .14 * tone(174.61, 3, .23) + .13 * tone(130.81, 3, .46) + .2 * rumble * tail(3); break;
      }
      // A short attack and final taper prevent clicks while preserving impact transients.
      samples[i] = Math.tanh(sample * 1.2) * Math.min(1, t / .0015, (samples.length - i) / 240);
    }
    effects.set(kind, buffer);
  }
  return effects;
}

export function createAudio() {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  let context, effects, sfxGain, musicGain, musicSource, music;
  let suspension = Promise.resolve();
  let unlocked = false, sfxEnabled = true, musicEnabled = true, paused = false, disposed = false, musicError = '', played = 0;
  const voices = new Set(), lastPlayed = new Map();

  function stopEffects() {
    for (const source of voices) source.stop();
    voices.clear(); lastPlayed.clear();
  }
  function updateMusic() {
    if (!music) return;
    if (!unlocked || !musicEnabled || paused || disposed) { music.pause(); return; }
    const attempt = music.play();
    if (attempt) attempt.then(() => { musicError = ''; }, error => { if (error.name !== 'AbortError') musicError = error.message; });
  }
  function resumeContext() {
    if (context && context.state !== 'closed' && context.state !== 'running') return context.resume().catch(() => {});
    return Promise.resolve();
  }
  function suspendContext() {
    if (context?.state === 'running') suspension = context.suspend().catch(() => {});
  }
  return {
    async unlock() {
      if (disposed || !AudioContext) return false;
      try {
        if (!context) {
          context = new AudioContext();
          const limiter = context.createDynamicsCompressor();
          limiter.threshold.value = -14; limiter.knee.value = 12; limiter.ratio.value = 8;
          limiter.attack.value = .003; limiter.release.value = .15;
          sfxGain = context.createGain(); sfxGain.gain.value = .55;
          musicGain = context.createGain(); musicGain.gain.value = .14;
          sfxGain.connect(limiter); musicGain.connect(limiter); limiter.connect(context.destination);
          effects = createEffects(context);
          music = new Audio(new URL('./assets/audio/space-adventure.mp3', import.meta.url).href);
          music.loop = true; music.preload = 'none';
          music.addEventListener('error', () => { musicError = 'Soundtrack could not be loaded.'; });
          musicSource = context.createMediaElementSource(music); musicSource.connect(musicGain);
        }
        unlocked = true;
        const resumed = paused ? Promise.resolve() : resumeContext();
        updateMusic(); // Invoke play during the gesture, before awaiting the context resume.
        await resumed;
        return true;
      } catch (error) { musicError = error.message; return false; }
    },
    play(kind = 'order') {
      kind = aliases[kind] || kind;
      const terminal = kind === 'victory' || kind === 'defeat';
      if (disposed || !unlocked || !sfxEnabled || !context || context.state === 'closed' || !terminal && (paused || context.state !== 'running')) return false;
      const buffer = effects.get(kind), now = context.currentTime;
      if (!buffer || voices.size >= 20 || now - (lastPlayed.get(kind) ?? -Infinity) < (cooldowns[kind] || .045)) return false;
      lastPlayed.set(kind, now);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(sfxGain);
      source.onended = () => { source.disconnect(); voices.delete(source); if (paused && !voices.size) suspendContext(); };
      voices.add(source); source.start(); played++;
      // The result menu pauses the game before its cue; wait out that suspension without restarting music.
      if (terminal && paused) suspension.then(() => { if (voices.has(source) && paused && !disposed) resumeContext(); });
      return true;
    },
    setSfxEnabled(value) {
      sfxEnabled = Boolean(value);
      if (!sfxEnabled) stopEffects();
    },
    setMusicEnabled(value) { musicEnabled = Boolean(value); updateMusic(); },
    setPaused(value) {
      paused = Boolean(value);
      if (paused) {
        stopEffects();
        suspendContext();
      } else if (unlocked) suspension.then(() => { if (!paused && !disposed) resumeContext(); });
      updateMusic();
    },
    get status() {
      return { supported: Boolean(AudioContext), unlocked, sfxEnabled, musicEnabled, paused, activeVoices: voices.size, played, musicPlaying: Boolean(music && !music.paused), musicError, contextState: context?.state || 'locked' };
    },
    dispose() {
      disposed = true; stopEffects(); music?.pause();
      if (music) { music.removeAttribute('src'); music.load(); }
      musicSource?.disconnect();
      if (context && context.state !== 'closed') context.close().catch(() => {});
    }
  };
}
