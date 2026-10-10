// Ashline's audio engine. soundbank.js synthesizes every effect (in a worker when the browser allows it);
// the locally hosted CC0 soundtrack is credited in assets/audio/CREDITS.md.
import { RECIPES, SOUND_KINDS, AMBIENT_KINDS, ALIASES, RATE, renderKind, renderVoice, parseVoiceKey, VOICE_RECIPE, TRANSMISSION_RECIPE } from './soundbank.js';

export { SOUND_KINDS, AMBIENT_KINDS };
export const SETTINGS_KEY = 'ashline.audio.v1';
export const VOLUME_CHANNELS = ['master', 'music', 'effects', 'voices', 'ambient'];
export const VOLUME_DEFAULTS = Object.freeze({ master: 1, music: .7, effects: .8, voices: .8, ambient: .7 });
// Interface sounds keep their own reserve, so a large battle can never swallow a click. Alerts, result
// stingers and unit voices have no cap: their recipes carry cooldowns instead.
export const VOICE_CAPS = Object.freeze({ ui: 4, weapon: 12, impact: 8 });
export const BANK_SIZE = Object.values(RECIPES).reduce((sum, recipe) => sum + (recipe.variants || 1), 0);
// Slider values map through a square law; these bases keep the default mix near the original levels.
const BASE = { master: 1, music: .28, effects: .85, voices: .9, ambient: .55 };
const BUS_LEVELS = { ui: .75, alerts: .95, weapons: .72, impacts: .85, voice: 1, ambient: .7 };
const BEDS = ['wind', 'lava', 'industry'];
const TERMINAL = new Set(['victory', 'defeat']);
const QUEUE_LIMIT = 12, VOICE_CACHE = 160;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Calm play hears a muffled, quieter soundtrack; heavy visible combat opens it fully.
const musicCutoff = intensity => 1800 * 2 ** (intensity * 3.2), musicGain = intensity => .7 + .3 * intensity;
const wallTime = () => performance.now() / 1000;
// Sandboxed frames can throw on the localStorage getter itself.
const defaultStorage = () => { try { return globalThis.localStorage; } catch { return null; } };

export function readAudioSettings(storage = defaultStorage()) {
  const settings = { volumes: { ...VOLUME_DEFAULTS }, sfxEnabled: true, musicEnabled: true };
  try {
    const data = JSON.parse(storage?.getItem(SETTINGS_KEY) || 'null');
    if (!data || typeof data !== 'object') return settings;
    for (const channel of VOLUME_CHANNELS) {
      const value = data.volumes?.[channel];
      if (typeof value === 'number' && Number.isFinite(value)) settings.volumes[channel] = clamp(value, 0, 1);
    }
    if (typeof data.sfxEnabled === 'boolean') settings.sfxEnabled = data.sfxEnabled;
    if (typeof data.musicEnabled === 'boolean') settings.musicEnabled = data.musicEnabled;
  } catch { /* Unreadable or blocked storage falls back to the defaults. */ }
  return settings;
}

// Category order decides what becomes audible first: interface, weapons, impacts, alerts, result stingers,
// abilities and loops; extra variants of weapons and impacts follow once every kind has one buffer.
function bankJobs() {
  const rank = kind => {
    const recipe = RECIPES[kind];
    if (recipe.loop) return 6;
    if (TERMINAL.has(kind)) return 4;
    return { ui: 0, weapon: 1, impact: 2 }[recipe.category] ?? (recipe.bus === 'ui' ? 5 : 3);
  };
  const kinds = Object.keys(RECIPES).sort((a, b) => rank(a) - rank(b));
  const jobs = kinds.map(name => ({ name, variant: 0 }));
  for (const name of kinds) for (let variant = 1; variant < (RECIPES[name].variants || 1); variant++) jobs.push({ name, variant });
  return jobs;
}

// Turns recipes into AudioBuffers lazily. A module worker renders the samples; without one, the main thread
// renders in short timer slices. Voice lines are rendered on demand and kept in a bounded cache.
function createBank(context, onReady) {
  const buffers = new Map(), voices = new Map(), wanted = new Map(), queue = [], flight = new Map();
  const stats = { mode: 'main', total: BANK_SIZE, loaded: 0, voices: 0, mainMs: 0, longestMs: 0, failed: 0 };
  let worker = null, timer = 0, nextId = 1, closed = false;
  const keyOf = (name, variant) => `${name}#${variant}`;
  function store(job, samples) {
    const started = performance.now(), key = keyOf(job.name, job.variant);
    wanted.delete(key);
    if (closed) return;
    const buffer = context.createBuffer(1, samples.length, RATE);
    buffer.copyToChannel(samples, 0);
    if (job.voice) {
      voices.set(key, buffer); stats.voices = voices.size;
      if (voices.size > VOICE_CACHE) voices.delete(voices.keys().next().value);
    } else { buffers.set(key, buffer); stats.loaded = buffers.size; }
    account(performance.now() - started);
    onReady(job.name, job.variant, job.voice);
  }
  function account(ms) { stats.mainMs += ms; stats.longestMs = Math.max(stats.longestMs, ms); }
  function fail(job) { wanted.delete(keyOf(job.name, job.variant)); stats.failed++; }
  function fallback() {
    if (!worker) return;
    worker.terminate(); worker = null; stats.mode = 'main';
    queue.unshift(...flight.values()); flight.clear(); pump();
  }
  function pump() {
    if (closed) return;
    if (worker) {
      while (flight.size < 3 && queue.length) {
        const job = queue.shift(), id = nextId++;
        flight.set(id, job); worker.postMessage({ id, ...job });
      }
    } else if (!timer && queue.length) timer = setTimeout(slice, 0);
  }
  // Main-thread fallback: one or more renders per slice, yielding to input and drawing between slices.
  function slice() {
    timer = 0;
    const end = performance.now() + 6;
    do {
      const job = queue.shift(), started = performance.now();
      try {
        const samples = job.voice ? renderVoice(job.name, job.variant) : renderKind(job.name, job.variant);
        account(performance.now() - started); store(job, samples);
      } catch { fail(job); }
    } while (queue.length && performance.now() < end && !closed);
    pump();
  }
  return {
    stats,
    start() {
      if (globalThis.location?.protocol !== 'file:' && typeof Worker === 'function') {
        try {
          worker = new Worker(new URL('./sound-worker.js', import.meta.url), { type: 'module' });
          stats.mode = 'worker';
          worker.onmessage = ({ data }) => {
            const job = flight.get(data.id);
            if (!job) return;
            flight.delete(data.id);
            if (data.error) fail(job); else store(job, data.samples);
            pump();
          };
          worker.onerror = event => { event.preventDefault?.(); fallback(); };
        } catch { worker = null; stats.mode = 'main'; }
      }
      for (const job of bankJobs()) this.request(job.name, job.variant);
    },
    get(name, variant, voice = false) {
      const key = keyOf(name, variant), cache = voice ? voices : buffers, buffer = cache.get(key);
      if (buffer && voice) { cache.delete(key); cache.set(key, buffer); }
      return buffer || null;
    },
    request(name, variant, voice = false, urgent = false) {
      const key = keyOf(name, variant);
      if ((voice ? voices : buffers).has(key)) return;
      const queued = wanted.get(key);
      if (queued) {
        if (urgent && queue.includes(queued)) { queue.splice(queue.indexOf(queued), 1); queue.unshift(queued); }
        return;
      }
      const job = { name, variant, voice };
      wanted.set(key, job);
      if (urgent) queue.unshift(job); else queue.push(job);
      pump();
    },
    close() { closed = true; clearTimeout(timer); worker?.terminate(); worker = null; queue.length = 0; flight.clear(); },
  };
}

export function createAudio({ storage = defaultStorage() } = {}) {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  const settings = readAudioSettings(storage), volumes = settings.volumes;
  let context, bank, master, groups, buses, combatDuck, musicDuck, musicFilter, musicLevel, musicFade, musicSource, music;
  let suspension = Promise.resolve(), pauseTimer = 0, musicTimer = 0;
  let unlocked = false, sfxEnabled = settings.sfxEnabled, musicEnabled = settings.musicEnabled, paused = false, disposed = false, musicError = '';
  let played = 0, dropped = 0, stolen = 0, aggregated = 0, queued = 0, expired = 0, intensity = 0, ambientLevels = {};
  const startup = { contextMs: 0, setupMs: 0 };
  let speaking = null, transmitting = null;
  const voices = new Set(), lastPlayed = new Map(), lastVariant = new Map(), beds = new Map(), ducks = {};
  let pending = [];

  function persist() {
    try { storage?.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, volumes, sfxEnabled, musicEnabled })); } catch { /* Private modes may refuse storage; the session keeps its settings. */ }
  }
  function applyVolumes(time = .03) {
    if (!context) return;
    const now = context.currentTime, set = (node, value) => node.gain.setTargetAtTime(value, now, time);
    set(master, BASE.master * volumes.master ** 2);
    set(groups.effects, sfxEnabled ? BASE.effects * volumes.effects ** 2 : 0);
    set(groups.voices, sfxEnabled ? BASE.voices * volumes.voices ** 2 : 0);
    set(groups.ambient, sfxEnabled ? BASE.ambient * volumes.ambient ** 2 : 0);
    set(groups.music, BASE.music * volumes.music ** 2);
  }
  // Startup timing separates the browser's audio-device start (the context constructor) from Ashline's own setup.
  function build() {
    const started = performance.now();
    context = new AudioContext({ latencyHint: 'interactive' });
    const created = performance.now();
    const glue = context.createDynamicsCompressor(), limiter = context.createDynamicsCompressor();
    // Glue: gentle bus compression that holds a battle together. Limiter: a fast brickwall below 0 dBFS.
    glue.threshold.value = -20; glue.knee.value = 8; glue.ratio.value = 3; glue.attack.value = .008; glue.release.value = .25;
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .001; limiter.release.value = .08;
    master = context.createGain(); master.connect(glue); glue.connect(limiter); limiter.connect(context.destination);
    const gain = (value, to) => { const node = context.createGain(); node.gain.value = value; if (to) node.connect(to); return node; };
    groups = { effects: gain(0, master), voices: gain(0, master), ambient: gain(0, master), music: gain(0, master) };
    combatDuck = gain(1, groups.effects); musicDuck = gain(1, groups.music);
    buses = {
      ui: gain(BUS_LEVELS.ui, groups.effects), alerts: gain(BUS_LEVELS.alerts, groups.effects),
      weapons: gain(BUS_LEVELS.weapons, combatDuck), impacts: gain(BUS_LEVELS.impacts, combatDuck),
      voice: gain(BUS_LEVELS.voice, groups.voices), ambient: gain(BUS_LEVELS.ambient, groups.ambient),
    };
    // Combat beyond the view shares one muffling lowpass instead of a filter per voice.
    const distance = context.createBiquadFilter(); distance.type = 'lowpass'; distance.frequency.value = 2200; distance.Q.value = .5;
    // It runs at unity: each cue brings its own bus level, so a shot leaving the view never gets louder.
    distance.connect(combatDuck); buses.distant = gain(1, distance);
    musicFade = gain(1, musicDuck); musicLevel = gain(1, musicFade);
    musicFilter = context.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.Q.value = .5; musicFilter.connect(musicLevel);
    musicFilter.frequency.value = musicCutoff(intensity); musicLevel.gain.value = musicGain(intensity);
    applyVolumes(.001);
    context.addEventListener?.('statechange', flush);
    bank = createBank(context, flush);
    bank.start();
    music = new Audio(new URL('./assets/audio/space-adventure.mp3', import.meta.url).href);
    music.loop = true; music.preload = 'none';
    music.addEventListener('error', () => { musicError = 'Soundtrack could not be loaded.'; });
    musicSource = context.createMediaElementSource(music); musicSource.connect(musicFilter);
    Object.assign(startup, { contextMs: created - started, setupMs: performance.now() - created });
  }

  function release(record) {
    voices.delete(record);
    try { record.source.disconnect(); record.gain.disconnect(); record.panner?.disconnect(); } catch { /* Already disconnected. */ }
    if (speaking === record) speaking = null;
    if (transmitting === record) transmitting = null;
    if (paused) settlePause();
  }
  function fadeOut(record, time = .012) {
    voices.delete(record);
    if (!context) return;
    const now = context.currentTime;
    try { record.gain.gain.cancelScheduledValues(now); record.gain.gain.setTargetAtTime(0, now, time); record.source.stop(now + time * 5); } catch { /* Already stopped. */ }
  }
  function stopEffects() {
    for (const record of [...voices]) fadeOut(record, .008);
    voices.clear(); lastPlayed.clear(); speaking = transmitting = null;
    pending = pending.filter(cue => TERMINAL.has(cue.name) && paused);
  }
  function stopAmbient() {
    for (const bed of beds.values()) { bed.gain.gain.setTargetAtTime(0, context.currentTime, .05); try { bed.source.stop(context.currentTime + .3); } catch { /* Already stopped. */ } }
    beds.clear();
  }
  // Sidechain-style ducking: alerts and voices pull the combat buses and the soundtrack down for their
  // length, then release. Overlapping cues keep the deepest dip until the last one ends.
  function duck(depth, seconds) {
    const now = context.currentTime;
    for (const [name, node, scale] of [['combat', combatDuck, 1], ['music', musicDuck, .7]]) {
      const state = ducks[name] ??= { depth: 0, until: 0 }, amount = depth * scale;
      state.depth = now < state.until ? Math.max(state.depth, amount) : amount;
      state.until = Math.max(state.until, now + seconds);
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(1 - state.depth, now, .03);
      node.gain.setTargetAtTime(1, state.until, .25);
    }
  }
  function start(name, buffer, recipe, category, options) {
    const combat = recipe.bus === 'weapons' || recipe.bus === 'impacts', distant = Boolean(options.distant && combat), bus = distant ? buses.distant : buses[recipe.bus];
    const now = context.currentTime, source = context.createBufferSource(), level = clamp(options.gain ?? 1, 0, 2) * (distant ? BUS_LEVELS[recipe.bus] : 1);
    const rate = clamp((options.rate || 1) * (recipe.jitter ? 1 + (Math.random() * 2 - 1) * recipe.jitter : 1), .5, 2);
    source.buffer = buffer; source.playbackRate.value = rate;
    const gain = context.createGain(); gain.gain.value = level; source.connect(gain);
    let panner = null;
    const pan = clamp(options.pan || 0, -1, 1);
    if (pan && context.createStereoPanner) { panner = context.createStereoPanner(); panner.pan.value = pan; gain.connect(panner); panner.connect(bus); } else gain.connect(bus);
    const record = { source, gain, panner, name, category, start: now, end: now + buffer.duration / rate, level, boost: 1, terminal: TERMINAL.has(name) };
    source.onended = () => release(record);
    voices.add(record); source.start(); played++;
    if (recipe.duck) duck(recipe.duck, buffer.duration / rate);
    return record;
  }
  // Steals the quietest voice of a full category, weighing level by what is left of it; a new sound that
  // would be quieter than everything already playing is dropped instead.
  function allocate(category, level) {
    const cap = VOICE_CAPS[category];
    if (!cap) return true;
    const now = context.currentTime;
    let count = 0, victim = null, lowest = Infinity;
    for (const record of voices) {
      if (record.category !== category) continue;
      count++;
      const score = record.level * record.boost * Math.max(0, (record.end - now) / Math.max(1e-3, record.end - record.start));
      if (score < lowest) { lowest = score; victim = record; }
    }
    if (count < cap) return true;
    if (level < lowest * .5) { dropped++; return false; }
    fadeOut(victim); stolen++;
    return true;
  }
  function pickVariant(name, variants, ready) {
    const options = [];
    for (let variant = 0; variant < variants; variant++) if (ready(variant)) options.push(variant);
    if (options.length > 1) { const last = lastVariant.get(name), index = options.indexOf(last); if (index >= 0) options.splice(index, 1); }
    const variant = options.length ? options[Math.floor(Math.random() * options.length)] : -1;
    if (variant >= 0) lastVariant.set(name, variant);
    return variant;
  }
  const blocked = terminal => disposed || !unlocked || !sfxEnabled || !context || context.state === 'closed' || paused && !terminal;
  // Returns true once started, null while the cue must wait for the context or its buffer, false when rejected.
  function attempt(cue) {
    const { name, options } = cue, recipe = RECIPES[name], terminal = TERMINAL.has(name), category = recipe.category;
    if (blocked(terminal) || volumes.effects <= 0) return false;
    if (context.state !== 'running') return null;
    const variant = pickVariant(name, recipe.variants || 1, index => bank.get(name, index));
    if (variant < 0) { bank.request(name, 0, false, true); return null; }
    if (!allocate(category, clamp(options.gain ?? 1, 0, 2))) return false;
    start(name, bank.get(name, variant), recipe, terminal ? 'terminal' : category, options);
    return true;
  }
  function attemptVoice(cue) {
    const { name, variant, options } = cue, transmission = cue.transmission;
    if (blocked(false) || volumes.voices <= 0) return false;
    const buffer = bank.get(name, variant, true);
    if (!buffer) { bank.request(name, variant, true, true); return null; }
    if (context.state !== 'running') return null;
    const previous = transmission ? transmitting : speaking;
    if (previous && voices.has(previous)) fadeOut(previous, .02);
    const record = start(name, buffer, transmission ? TRANSMISSION_RECIPE : VOICE_RECIPE, 'voice', options);
    if (transmission) transmitting = record; else speaking = record;
    return true;
  }
  function enqueue(cue) {
    pending.push(cue); queued++;
    if (pending.length > QUEUE_LIMIT) { pending.shift(); expired++; }
  }
  function flush() {
    if (!context || !pending.length) return;
    const now = wallTime(), waiting = pending;
    pending = [];
    for (const cue of waiting) {
      if (cue.expires < now) { expired++; continue; }
      const result = cue.voice ? attemptVoice(cue) : attempt(cue);
      if (result === null) pending.push(cue);
    }
  }

  function resumeContext() {
    if (context && context.state !== 'closed' && context.state !== 'running') return context.resume().catch(() => {});
    return Promise.resolve();
  }
  function suspendContext() {
    if (context?.state === 'running') suspension = context.suspend().catch(() => {});
  }
  const terminalActive = () => [...voices].some(record => record.terminal) || pending.some(cue => TERMINAL.has(cue.name));
  function settlePause() {
    if (paused && !pauseTimer && !terminalActive()) suspendContext();
  }
  function fadeMusic(target, time) {
    if (!context) return;
    const now = context.currentTime;
    musicFade.gain.cancelScheduledValues(now); musicFade.gain.setTargetAtTime(target, now, time);
  }
  function updateMusic() {
    if (!music) return;
    if (!unlocked || !musicEnabled || paused || disposed) { clearTimeout(musicTimer); musicTimer = 0; music.pause(); return; }
    clearTimeout(musicTimer); musicTimer = 0; fadeMusic(1, .15);
    const attempt = music.play();
    if (attempt) attempt.then(() => { musicError = ''; }, error => { if (error.name !== 'AbortError') musicError = error.message; });
  }
  // The soundtrack fades instead of cutting; the context suspends only after the fade and any result stinger.
  function fadeMusicThenPause(seconds) {
    if (!music || music.paused) return;
    fadeMusic(0, seconds / 4);
    clearTimeout(musicTimer);
    musicTimer = setTimeout(() => { musicTimer = 0; if (paused || !musicEnabled) music.pause(); }, seconds * 1000);
  }

  return {
    async unlock() {
      if (disposed || !AudioContext) return false;
      try {
        if (!context) build();
        unlocked = true;
        const resumed = paused ? Promise.resolve() : resumeContext();
        updateMusic(); // Invoke play during the gesture, before awaiting the context resume.
        await resumed;
        return true;
      } catch (error) { musicError = error.message; return false; }
    },
    play(kind = 'order', options = {}) {
      const name = ALIASES[kind] || kind, recipe = RECIPES[name];
      if (!recipe || recipe.loop) return false;
      const terminal = TERMINAL.has(name);
      if (blocked(terminal)) return false;
      // Identical cues inside a recipe's cooldown merge into the voice already playing.
      const now = wallTime(), cooldown = recipe.cooldown ?? .045;
      if (now - (lastPlayed.get(name) ?? -Infinity) < cooldown) {
        if (recipe.category === 'weapon' || recipe.category === 'impact') {
          let latest = null;
          for (const record of voices) if (record.name === name && (!latest || record.start > latest.start)) latest = record;
          if (latest) { latest.boost = Math.min(1.5, latest.boost * 1.12); latest.gain.gain.setTargetAtTime(latest.level * latest.boost, context.currentTime, .01); aggregated++; }
        }
        return false;
      }
      lastPlayed.set(name, now);
      const cue = { name, options, expires: now + (recipe.category === 'alert' || terminal ? 2.5 : 1.2) };
      if (terminal && paused) {
        // The result menu pauses the game before its cue: keep the context alive and fade the soundtrack under it.
        clearTimeout(pauseTimer); pauseTimer = 0;
        fadeMusicThenPause(2.4);
        suspension.then(() => { if (paused && !disposed) resumeContext(); });
      }
      const result = attempt(cue);
      if (result !== null) return result;
      if (recipe.category === 'weapon' || recipe.category === 'impact') { dropped++; return false; }
      enqueue(cue);
      return true;
    },
    // Wordless acknowledgement or transmission line by voice key (see soundbank.js). Unit lines are
    // monophonic: a new line fades the previous one out. Late lines expire instead of playing stale.
    voice(key, options = {}) {
      const parsed = parseVoiceKey(key);
      if (!parsed || blocked(false)) return false;
      const transmission = parsed.context === 'transmission', recipe = transmission ? TRANSMISSION_RECIPE : VOICE_RECIPE;
      const variant = Number.isInteger(options.variant) ? clamp(options.variant, 0, recipe.variants - 1) : pickVariant(key, recipe.variants, () => true);
      const cue = { voice: true, transmission, name: key, variant, options, expires: wallTime() + (transmission ? 1.5 : .35) };
      const result = attemptVoice(cue);
      if (result !== null) return result;
      enqueue(cue);
      return true;
    },
    prewarmVoices(keys) {
      if (!bank) return;
      for (const key of keys) if (parseVoiceKey(key)) for (let variant = 0; variant < VOICE_RECIPE.variants; variant++) bank.request(key, variant, true);
    },
    // Looping beds: {wind, lava, industry} → {gain 0–1, pan −1–1}. They never count as voices.
    setAmbient(levels = {}) {
      ambientLevels = levels;
      if (blocked(false) || context.state !== 'running' || volumes.ambient <= 0) return;
      const now = context.currentTime;
      for (const name of BEDS) {
        const target = clamp(levels[name]?.gain ?? 0, 0, 1), pan = clamp(levels[name]?.pan ?? 0, -1, 1);
        let bed = beds.get(name);
        if (!bed && target > .01) {
          const buffer = bank.get(`ambient.${name}`, 0);
          if (!buffer) { bank.request(`ambient.${name}`, 0, false, true); continue; }
          const source = context.createBufferSource(), gain = context.createGain(), panner = context.createStereoPanner?.();
          source.buffer = buffer; source.loop = true; gain.gain.value = 0; source.connect(gain);
          if (panner) { gain.connect(panner); panner.connect(buses.ambient); } else gain.connect(buses.ambient);
          source.start(now, Math.random() * buffer.duration);
          bed = { source, gain, panner, target: 0, pan: 0, quietSince: null }; beds.set(name, bed);
        }
        if (!bed) continue;
        // Unchanged levels add no automation events; the soundscape refreshes them four times a second.
        if (Math.abs(target - bed.target) > .005) { bed.target = target; bed.gain.gain.setTargetAtTime(target, now, .6); }
        if (bed.panner && Math.abs(pan - bed.pan) > .01) { bed.pan = pan; bed.panner.pan.setTargetAtTime(pan, now, .6); }
        if (target > .01) bed.quietSince = null;
        else if ((bed.quietSince ??= now) < now - 3) { try { bed.source.stop(); } catch { /* Already stopped. */ } beds.delete(name); }
      }
    },
    // Combat intensity 0–1 opens the soundtrack's lowpass and lifts its level.
    setIntensity(value) {
      const next = clamp(Number(value) || 0, 0, 1), changed = Math.abs(next - intensity) > .002;
      intensity = next;
      if (!context || !changed) return;
      const now = context.currentTime;
      musicFilter.frequency.setTargetAtTime(musicCutoff(intensity), now, 1.2);
      musicLevel.gain.setTargetAtTime(musicGain(intensity), now, 1.2);
    },
    setVolume(channel, value) {
      if (!VOLUME_CHANNELS.includes(channel) || !Number.isFinite(Number(value))) return false;
      volumes[channel] = Math.round(clamp(Number(value), 0, 1) * 100) / 100;
      applyVolumes(); persist();
      if (channel === 'ambient' && volumes.ambient <= 0 && context) stopAmbient();
      return true;
    },
    setSfxEnabled(value) {
      sfxEnabled = Boolean(value);
      if (!sfxEnabled) { stopEffects(); if (context) stopAmbient(); pending = []; }
      applyVolumes(); persist();
    },
    setMusicEnabled(value) { musicEnabled = Boolean(value); updateMusic(); persist(); },
    setPaused(value) {
      const was = paused;
      paused = Boolean(value);
      if (paused) {
        stopEffects();
        if (context) stopAmbient();
        if (!was && music && !music.paused) {
          fadeMusicThenPause(.3);
          clearTimeout(pauseTimer);
          pauseTimer = setTimeout(() => { pauseTimer = 0; if (paused && !terminalActive()) { music.pause(); suspendContext(); } }, 300);
        } else if (!pauseTimer) { updateMusic(); settlePause(); }
        return;
      }
      clearTimeout(pauseTimer); pauseTimer = 0;
      if (unlocked) suspension.then(() => { if (!paused && !disposed) resumeContext(); });
      updateMusic();
    },
    get settings() { return { volumes: { ...volumes }, sfxEnabled, musicEnabled }; },
    get status() {
      const byCategory = {};
      for (const record of voices) byCategory[record.category] = (byCategory[record.category] || 0) + 1;
      const now = context?.currentTime ?? 0, duckDepth = name => ducks[name] && ducks[name].until > now ? ducks[name].depth : 0;
      return {
        supported: Boolean(AudioContext), unlocked, sfxEnabled, musicEnabled, paused, activeVoices: voices.size, voicesByCategory: byCategory,
        played, dropped, stolen, aggregated, queued, expired, pending: pending.length,
        musicPlaying: Boolean(music && !music.paused), musicError, contextState: context?.state || 'locked',
        volumes: { ...volumes }, intensity, startup: { ...startup }, ducking: { combat: duckDepth('combat'), music: duckDepth('music') },
        ambient: Object.fromEntries(BEDS.map(name => [name, beds.get(name)?.target ?? 0])), ambientActive: beds.size, ambientRequested: ambientLevels,
        bank: bank ? { ...bank.stats, ready: bank.stats.loaded === bank.stats.total } : { mode: 'idle', total: BANK_SIZE, loaded: 0, voices: 0, mainMs: 0, longestMs: 0, failed: 0, ready: false },
      };
    },
    dispose() {
      disposed = true; stopEffects(); pending = [];
      clearTimeout(pauseTimer); clearTimeout(musicTimer);
      if (context) stopAmbient();
      bank?.close(); music?.pause();
      if (music) { music.removeAttribute('src'); music.load(); }
      musicSource?.disconnect();
      if (context && context.state !== 'closed') context.close().catch(() => {});
    },
  };
}
