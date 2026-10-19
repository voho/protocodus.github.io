// Asset loading starts in preflight and playback only reads memory. A song still
// downloading at launch joins the mix as soon as it is ready; until then another
// ready song plays, or nothing. The synthesizer only stands in for effects.
import { audioAssets, SAMPLE_GROUPS as SAMPLES, SONGS } from './audio-assets.js';
export { preloadAudio } from './audio-assets.js';

const FLIGHT_SONGS = Object.freeze(['flight', 'flight2', 'flight3']);
// Synth layers are short, but a rampage could still stack hundreds of them.
const MAX_SYNTH_VOICES = 64;
// Dense combat cues share one voice budget so announcements always get through.
const COMBAT = new Set(['laser-small', 'laser-retro', 'laser-heavy', 'enemy-shot', 'enemy-shot-heavy', 'explosion', 'explosion-large', 'boom', 'debris', 'impact', 'shield-hit', 'deflect', 'graze']);
const COMBAT_VOICES = 16;
const GROUP_VOICES = { 'laser-small': 5, 'laser-retro': 5, 'laser-heavy': 5, 'enemy-shot': 4, explosion: 4 };
// Decaying stereo noise with a soft onset: a small hangar-like room.
function roomImpulse(context, seconds) {
  const rate = context.sampleRate, length = Math.floor(rate * seconds), onset = rate * .012;
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6 * Math.min(1, i / onset);
  }
  return buffer;
}
// A media element can only bind to one MediaElementAudioSourceNode. Production
// has one engine; additional consumers stay without music rather than take it over.
const musicOwners = new WeakMap();

export class AudioEngine {
  constructor() {
    this.context = null; this.muted = false; this.active = false; this.transitionGain = 1; this.lastShot = 0;
    this.samples = audioAssets.samples; this.sampleVoices = new Set(); this.synthVoices = new Set(); this.lastSample = new Map();
    this.failedSongs = new Set(); this.songKey = 'flight'; this.musicPlaying = false; this.musicToken = 0; this.attachedPlayers = 0;
    this.musicPlayers = new Map(); this.musicSources = new Map(); this.musicChannels = new Map();
    this.unlockedSongs = new Set(); this.blockedSongs = new Set(); this.musicUnlocks = new Map(); this.musicAttempts = new Map();
    // Safari authorizes each media element by gesture. A song that arrives after
    // the launch click, or a refused play, is retried on the next key or tap.
    // Registered first, so flight input handlers cannot stop it from running.
    this.onGesture = () => { if (this.needsGesture()) this.start(); };
    for (const type of ['keydown', 'pointerdown', 'touchend']) globalThis.addEventListener?.(type, this.onGesture, { capture: true, passive: true });
  }
  needsGesture() {
    if (!this.context || this.muted) return false;
    if (this.context.state === 'suspended' || this.context.state === 'interrupted' || this.musicBlocked) return true;
    for (const key of this.musicPlayers.keys()) if (!this.unlockedSongs.has(key) && !this.failedSongs.has(key) && !this.musicUnlocks.has(key)) return true;
    return false;
  }
  start() {
    if (this.muted) return;
    try {
      if (!this.context) {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        // A gentle limiter keeps mass kills and novas from clipping the mix.
        this.limiter = this.context.createDynamicsCompressor();
        this.limiter.threshold.value = -12; this.limiter.knee.value = 10; this.limiter.ratio.value = 12;
        this.limiter.attack.value = .003; this.limiter.release.value = .2;
        this.master = this.context.createGain(); this.master.gain.value = .34; this.master.connect(this.limiter);
        // Fade after the limiter so its look-ahead/release cannot leak an audio
        // tail into the black frame. User mute remains a separate mix control.
        this.transitionBus = this.context.createGain(); this.transitionBus.gain.value = this.transitionGain;
        this.limiter.connect(this.transitionBus); this.transitionBus.connect(this.context.destination);
        const length = this.context.sampleRate * 2;
        this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        // Big explosions and novas send to a short procedural room so heavy
        // hits have space; shots and interface cues stay dry and close.
        this.reverbSend = this.context.createGain();
        this.reverbReturn = this.context.createGain(); this.reverbReturn.gain.value = .5;
        this.reverbReturn.connect(this.master);
        this.reverbImpulse = roomImpulse(this.context, 1.6);
        this.connectReverb();
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      this.prepareMusic();
      this.blockedSongs.clear(); this.musicBlocked = false;
      // Safari authorizes media elements individually. Every prepared player is
      // unlocked by this gesture; inactive channel gates keep the mixer silent.
      this.unlockMusic();
      this.playMusic();
    } catch { /* Audio is optional; gameplay continues on restricted browsers. */ }
  }
  mute(value) {
    this.muted = value;
    if (this.master) this.master.gain.setTargetAtTime(value ? 0 : .34, this.context.currentTime, .04);
    if (value) { this.stopMusic(); this.stopVoices(); }
  }
  setTransitionGain(value) {
    if (!Number.isFinite(value)) return;
    value = Math.max(0, Math.min(1, value));
    if (value === this.transitionGain) return;
    this.transitionGain = value;
    if (!this.transitionBus) return;
    const gain = this.transitionBus.gain, now = this.context.currentTime;
    if (value === 0) {
      // The preceding visual fade frames have already brought the signal down;
      // unlike an exponential tail, this endpoint guarantees complete silence.
      gain.cancelScheduledValues(now); gain.setValueAtTime(0, now);
    } else {
      if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
      else { const current = gain.value; gain.cancelScheduledValues(now); gain.setValueAtTime(current, now); }
      gain.linearRampToValueAtTime(value, now + .012);
    }
  }
  pause() { this.active = false; this.danger = -1; this.stopMusic(); this.stopVoices(); }
  stopVoices() {
    for (const voice of [...this.sampleVoices, ...this.synthVoices]) {
      try { voice.source.stop(); } catch { /* Already ended. */ }
    }
    this.sampleVoices.clear(); this.synthVoices.clear();
    // A convolver keeps ringing after its sources stop; replace it so pause
    // and mute are silent at once.
    if (this.reverb) this.connectReverb();
  }
  connectReverb() {
    this.reverb?.disconnect(); this.reverbSend.disconnect();
    this.reverb = this.context.createConvolver(); this.reverb.buffer = this.reverbImpulse;
    this.reverbSend.connect(this.reverb); this.reverb.connect(this.reverbReturn);
  }
  // Every voice gets its own panner, so positional cues follow the action
  // across the arena. Returned nodes are disconnected when the voice ends.
  route(source, nodes, pan = 0, reverb = 0) {
    let destination = this.master;
    if (pan && this.context.createStereoPanner) {
      const panner = this.context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      panner.connect(this.master); nodes.push(panner); destination = panner;
    }
    source.connect(destination);
    if (reverb > 0 && this.reverbSend) {
      const send = this.context.createGain(); send.gain.value = reverb;
      source.connect(send); send.connect(this.reverbSend); nodes.push(send);
    }
  }
  trackSynth(source, nodes) {
    const voice = { source }; this.synthVoices.add(voice);
    source.onended = () => { this.synthVoices.delete(voice); source.disconnect(); nodes.forEach(node => node.disconnect()); };
  }
  // Returns false only when the group has no decoded file, so callers can fall
  // back to the synthesizer; a cue dropped by a voice limit still counts.
  sample(group, volume, rate = 1, maxDuration = 2, pan = 0, reverb = 0, when = null, loop = false) {
    const available = SAMPLES[group]?.filter(key => this.samples.has(key)) || [];
    if (!available.length) return false;
    const combat = COMBAT.has(group);
    let busy = 0, same = 0;
    for (const voice of this.sampleVoices) { if (voice.combat) busy++; if (voice.group === group) same++; }
    if ((combat && busy >= COMBAT_VOICES) || same >= (GROUP_VOICES[group] || 3)) return true;
    const choices = available.filter(key => key !== this.lastSample.get(group));
    const pool = choices.length ? choices : available, key = pool[Math.floor(Math.random() * pool.length)];
    this.lastSample.set(group, key);
    const source = this.context.createBufferSource(), gain = this.context.createGain(), t = when ?? this.context.currentTime;
    // Combat sounds vary a little in pitch; melodic cues stay in tune.
    source.buffer = this.samples.get(key); source.playbackRate.value = rate * (combat ? .96 + Math.random() * .08 : .995 + Math.random() * .01);
    source.loop = loop;
    const duration = loop ? maxDuration : Math.min(maxDuration, source.buffer.duration / source.playbackRate.value);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(volume, t + .004);
    gain.gain.setValueAtTime(volume, t + Math.max(.004, duration - .04)); gain.gain.linearRampToValueAtTime(0, t + duration);
    const nodes = [gain];
    source.connect(gain); this.route(gain, nodes, pan, reverb);
    const voice = { source, group, combat }; this.sampleVoices.add(voice);
    source.onended = () => { this.sampleVoices.delete(voice); source.disconnect(); nodes.forEach(node => node.disconnect()); };
    source.start(t); source.stop(t + duration + .005);
    return true;
  }
  // Attaches every prepared song this engine does not have yet, including songs
  // that finish downloading during flight.
  prepareMusic() {
    if (!this.context || this.musicGraphFailed || audioAssets.players.size === this.attachedPlayers) return;
    try {
      if (!this.musicGain) {
        this.musicGain = this.context.createGain(); this.musicGain.gain.value = 0;
        // The soundtrack itself is untouched; a transparent low-pass muffles it
        // only at critical hull, and a duck makes room for the heaviest blasts.
        this.musicFilter = this.context.createBiquadFilter(); this.musicFilter.type = 'lowpass';
        this.musicFilter.frequency.value = this.danger > 0 ? 3200 - this.danger * 1800 : 20000; this.musicFilter.Q.value = .5;
        this.musicDuck = this.context.createGain();
        this.musicGain.connect(this.musicFilter); this.musicFilter.connect(this.musicDuck); this.musicDuck.connect(this.master);
      }
      this.attachedPlayers = audioAssets.players.size;
      for (const [key, player] of audioAssets.players) {
        if (this.musicPlayers.has(key) || musicOwners.has(player)) continue;
        let source, channel;
        try {
          source = this.context.createMediaElementSource(player);
          channel = this.context.createGain(); channel.gain.value = 0;
          source.connect(channel); channel.connect(this.musicGain);
          musicOwners.set(player, this); this.musicPlayers.set(key, player); this.musicSources.set(key, source);
          this.musicChannels.set(key, channel);
          player.addEventListener('playing', () => {
            this.unlockedSongs.add(key); this.blockedSongs.delete(key);
            if (player !== this.music || !this.active || this.muted) {
              player.pause();
              if (player === this.music) this.stopMusic();
            } else { this.musicPlaying = true; this.musicBlocked = false; }
          });
          player.addEventListener('waiting', () => { if (player === this.music) this.musicPlaying = false; });
          player.addEventListener('error', () => {
            this.failedSongs.add(key); player.pause();
            if (player === this.music) this.stopMusic();
          });
        } catch { source?.disconnect(); channel?.disconnect(); this.failedSongs.add(key); }
      }
      if (!this.music) { this.music = this.musicPlayers.get(this.songKey) || null; this.musicSource = this.musicSources.get(this.songKey) || null; }
      this.musicUnavailable = !this.musicPlayers.size;
    } catch { this.musicGraphFailed = this.musicUnavailable = true; this.music = null; }
  }
  musicFailure(key, error) {
    if (error?.name === 'AbortError') return;
    if (error?.name === 'NotAllowedError') { this.blockedSongs.add(key); this.unlockedSongs.delete(key); }
    else this.failedSongs.add(key);
    if (key === this.songKey) { this.musicBlocked = this.blockedSongs.has(key); this.musicPlaying = false; }
  }
  unlockMusic() {
    for (const [key, player] of this.musicPlayers) {
      if (player === this.music || this.unlockedSongs.has(key) || this.failedSongs.has(key) || this.musicUnlocks.has(key)) continue;
      const attempt = (this.musicAttempts.get(key) || 0) + 1;
      this.musicAttempts.set(key, attempt); this.musicUnlocks.set(key, attempt);
      try {
        Promise.resolve(player.play()).then(() => {
          if (this.musicAttempts.get(key) !== attempt) return;
          this.unlockedSongs.add(key); this.blockedSongs.delete(key);
          if (player !== this.music || !this.active || this.muted) player.pause();
        }, error => { if (this.musicAttempts.get(key) === attempt) this.musicFailure(key, error); })
          .finally(() => { if (this.musicUnlocks.get(key) === attempt) this.musicUnlocks.delete(key); });
      } catch (error) { this.musicUnlocks.delete(key); this.musicFailure(key, error); }
    }
  }
  playMusic() {
    if (!this.music || this.muted || this.blockedSongs.has(this.songKey) || !audioAssets.songs.has(this.songKey) || this.failedSongs.has(this.songKey) || this.musicPending || !this.music.paused) return;
    const token = ++this.musicToken, key = this.songKey, attempt = (this.musicAttempts.get(key) || 0) + 1;
    this.musicAttempts.set(key, attempt);
    this.musicPending = true;
    try {
      Promise.resolve(this.music.play()).catch(error => {
        if (token !== this.musicToken || this.musicAttempts.get(key) !== attempt) return;
        // A rejected gesture/autoplay attempt retries on the next gesture.
        // An unsupported or broken file is skipped for the rest of the visit.
        this.musicFailure(key, error);
      }).finally(() => { if (token === this.musicToken) this.musicPending = false; });
    } catch (error) { this.musicFailure(key, error); this.musicPending = false; }
  }
  stopMusic() {
    this.musicToken++; this.musicPending = false; this.musicPlaying = false;
    for (const key of this.musicPlayers.keys()) this.musicAttempts.set(key, (this.musicAttempts.get(key) || 0) + 1);
    this.musicUnlocks.clear();
    for (const channel of this.musicChannels.values()) channel.gain.setValueAtTime(0, this.context.currentTime);
    for (const player of this.musicPlayers.values()) player.pause();
    if (this.musicGain) this.musicGain.gain.setValueAtTime(0, this.context.currentTime);
    if (this.musicDuck) { this.musicDuck.gain.cancelScheduledValues(this.context.currentTime); this.musicDuck.gain.setValueAtTime(1, this.context.currentTime); }
    this.musicTarget = 0;
  }
  duck(depth, recover = .6) {
    if (!this.musicDuck || !this.musicPlaying) return;
    const gain = this.musicDuck.gain, now = this.context.currentTime;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
    else { const current = gain.value; gain.cancelScheduledValues(now); gain.setValueAtTime(current, now); }
    gain.linearRampToValueAtTime(Math.min(gain.value, 1 - depth), now + .03);
    gain.setTargetAtTime(1, now + .14, recover / 3);
  }
  // Critical hull muffles the soundtrack and sounds a soft two-tone alarm.
  updateDanger(danger) {
    const now = this.context.currentTime;
    if (this.musicFilter && danger !== this.danger) this.musicFilter.frequency.setTargetAtTime(danger > 0 ? 3200 - danger * 1800 : 20000, now, .15);
    this.danger = danger;
    if (danger <= 0) { this.nextAlarm = 0; return; }
    if (now < (this.nextAlarm || 0)) return;
    this.nextAlarm = now + 1.5 - danger * .6;
    if (this.sample('hull-alarm', .17, 1, .2)) this.sample('hull-alarm', .17, .75, .2, 0, 0, now + .12);
    else { this.tone(880, 870, .09, .04, 'square', now); this.tone(660, 655, .11, .04, 'square', now + .12); }
  }
  updateMusic(playing, mood, level = 0) {
    this.prepareMusic();
    if (!this.musicGain || this.musicUnavailable) return;
    if (!playing || this.muted) { if (this.music && (!this.music.paused || this.musicPending)) this.stopMusic(); return; }
    // Absolute sector order rotates the three flight tracks across every cycle.
    const sector = Number.isSafeInteger(level) && level >= 0 ? level : 0;
    const flight = FLIGHT_SONGS[sector % FLIGHT_SONGS.length];
    const key = this.songFor(mood === 'boss' || mood === 'challenge' ? mood : flight, flight);
    // Nothing ready yet: silence until a song arrives, never a stand-in tune.
    if (!key) return;
    if (key !== this.songKey || !this.music) {
      this.stopMusic(); this.songKey = key;
      this.music = this.musicPlayers.get(key);
      this.musicSource = this.musicSources.get(key);
      this.musicBlocked = this.blockedSongs.has(key);
      this.music.currentTime = 0;
    }
    const channel = this.musicChannels.get(key);
    if (channel.gain.value !== 1) channel.gain.setValueAtTime(1, this.context.currentTime);
    this.playMusic();
    // One automation event per change, not one per rendered frame.
    const target = SONGS[key].gain;
    if (this.musicTarget !== target) { this.musicTarget = target; this.musicGain.gain.setTargetAtTime(target, this.context.currentTime, .12); }
  }
  // The wanted song once it is ready. Until then the song already playing
  // continues, or another ready song starts, so a slow download is not silent.
  songFor(wanted, flight) {
    const ready = key => this.musicPlayers.has(key) && !this.failedSongs.has(key);
    if (ready(wanted)) return wanted;
    if (ready(this.songKey) && this.music && (!this.music.paused || this.musicPending)) return this.songKey;
    return [flight, ...FLIGHT_SONGS, 'boss', 'challenge'].find(ready) || null;
  }
  tone(frequency, end, duration, volume, type = 'sine', when = null, pan = 0, reverb = 0) {
    if (!this.context || this.muted || this.synthVoices.size >= MAX_SYNTH_VOICES) return;
    const t = when ?? this.context.currentTime, osc = this.context.createOscillator(), gain = this.context.createGain(), nodes = [gain];
    osc.type = type; osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(Math.max(15, end), t + duration);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(volume, t + .008); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); this.route(gain, nodes, pan, reverb);
    this.trackSynth(osc, nodes);
    osc.start(t); osc.stop(t + duration + .02);
  }
  burst(duration, volume, cutoff = 600, when = null, pan = 0, reverb = 0) {
    if (!this.context || this.muted || this.synthVoices.size >= MAX_SYNTH_VOICES) return;
    const t = when ?? this.context.currentTime, noise = this.context.createBufferSource(), gain = this.context.createGain(), filter = this.context.createBiquadFilter(), nodes = [filter, gain];
    noise.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.setValueAtTime(cutoff, t); filter.frequency.exponentialRampToValueAtTime(80, t + duration);
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    noise.connect(filter); filter.connect(gain); this.route(gain, nodes, pan, reverb);
    this.trackSynth(noise, nodes);
    noise.start(t); noise.stop(t + duration);
  }
  // Every cue plays a CC0 recording; its original synth layer only stands in
  // when that file could not be loaded.
  effect(type, size = 20, variant = '', pan = 0) {
    if (!this.context || this.muted || this.context.state !== 'running') return;
    const t = this.context.currentTime;
    if (type === 'shot') {
      if (t - this.lastShot < .045) return;
      this.lastShot = t;
      const group = variant === 'lance' || variant === 'plasma' ? 'laser-heavy' : variant === 'scatter' || variant === 'arc' ? 'laser-retro' : 'laser-small';
      const rate = { pulse: 1.12, scatter: .85, lance: 1.22, seeker: 1.32, plasma: .74, arc: 1.4 }[variant] || 1;
      if (this.sample(group, group === 'laser-heavy' ? .2 : group === 'laser-retro' ? .2 : .1, rate, group === 'laser-heavy' ? .45 : .24, pan)) return;
      const pitch = { pulse: 1150, scatter: 760, lance: 410, seeker: 930, plasma: 260, arc: 1380 }[variant] || 1150;
      this.tone(pitch, Math.max(80, pitch * .2), variant === 'lance' ? .17 : .085, variant === 'plasma' ? .1 : .065, variant === 'arc' ? 'square' : 'triangle', null, pan);
    }
    if (type === 'volley') {
      // Hostile fire is a quiet, throttled cue beneath the pilot's own guns;
      // small hulls snap high, capital ships cough low.
      if (t - (this.lastVolley || 0) < .07) return;
      this.lastVolley = t;
      const heavy = variant === 'boss' || size >= 40, pitch = heavy ? 300 : 1000 - Math.min(560, size * 14);
      if (this.sample(heavy ? 'enemy-shot-heavy' : 'enemy-shot', heavy ? .085 : .045, heavy ? .8 : 1.15 - Math.min(.35, size / 80), .3, pan)) return;
      this.tone(pitch, pitch * .45, heavy ? .16 : .07, heavy ? .045 : .028, heavy ? 'sawtooth' : 'triangle', null, pan);
    }
    if (type === 'explosion') {
      // Simultaneous kills share one voice slot per 35 ms instead of stacking.
      if (t - (this.lastExplosion || 0) < .035 && size < 60) return;
      this.lastExplosion = t;
      const big = size >= 45, reverb = big ? Math.min(.6, size / 160) : size >= 28 ? .12 : 0;
      const played = big
        ? this.sample('explosion-large', Math.min(.7, .3 + size / 300), Math.max(.78, 1.08 - size / 500), 1.6, pan, reverb)
        : this.sample('explosion', Math.min(.6, .25 + size / 170), Math.max(.8, 1.15 - size / 300), 1, pan, reverb);
      if (!played) { this.burst(Math.min(1.3, .18 + size / 130), Math.min(.5, .09 + size / 220), 1400, null, pan, reverb); this.tone(90, 22, .25 + size / 220, .2, 'sine', null, pan); }
      // Heavier hulls add a sub-bass thump and a short debris crackle.
      if (size >= 28) {
        if (!this.sample('boom', Math.min(.6, .16 + size / 180), Math.max(.7, 1.1 - size / 400), 1.5, pan * .5)) this.tone(72, 26, .3 + size / 300, Math.min(.3, .06 + size / 260), 'sine', null, pan * .5);
        if (!this.sample('debris', Math.min(.16, .04 + size / 900), 1, .5 + size / 400, pan, reverb * .5, t + .05)) this.burst(.18 + size / 500, Math.min(.07, .02 + size / 1500), 2600, t + .05, pan, reverb * .5);
      }
      if (big) this.duck(Math.min(.5, size / 200), .7);
    }
    if (type === 'hit') {
      if (variant === 'shield') {
        // A round spent on the shield: a bright, glassy deflection.
        if (!this.sample('shield-hit', .34, 1.1, .25, pan)) { this.burst(.08, .1, 6400, null, pan); this.tone(1900, 880, .16, .07, 'sine', null, pan); }
      } else {
        // Hull damage is heavier and lower, so it reads as real harm.
        if (!this.sample('impact', .6, .9, .45, pan)) { this.burst(.13, .18, 3200, null, pan); this.tone(420, 100, .2, .14, 'sawtooth', null, pan); }
        if (!this.sample('boom', .28, 1.25, .35, pan)) this.tone(120, 42, .22, .2, 'sine', null, pan);
        if (variant === 'kinetic' && !this.sample('deflect', .16, .75, .25, pan)) this.burst(.09, .09, 1800, null, pan);
      }
    }
    if (type === 'shield-break') {
      // The collapsing shield shatters, then its pulse thumps outward.
      if (!this.sample('shield-break', .5, .9, .5, pan, .3)) { this.tone(1500, 160, .42, .09, 'sawtooth', null, pan); this.burst(.3, .12, 7000, null, pan, .3); }
      if (!this.sample('boom', .4, 1, 1, pan, .2, t + .02)) this.tone(95, 40, .35, .22, 'sine', t + .02, pan);
      this.duck(.3, .5);
    }
    if (type === 'shield-online' && !this.sample('shield-up', .3, 1, .8, pan)) [523, 784, 1046].forEach((f, i) => this.tone(f, f * 1.01, .14, .05, 'triangle', t + i * .06, pan));
    if (type === 'barrier-break') {
      if (!this.sample('glass-break', .42, 1, .45, pan, .2)) { this.tone(2200, 300, .3, .06, 'square', null, pan); this.burst(.22, .1, 8000, null, pan, .2); }
      this.sample('deflect', .18, .7, .3, pan);
    }
    if (type === 'blocked') {
      // Barrier and sealed-armor hits tell the pilot whether the gun is working.
      if (t - (this.lastBlock || 0) < .06) return;
      this.lastBlock = t;
      const rate = variant === 'strong' ? 1.5 : variant === 'resist' ? .7 : variant === 'drone' ? 1.3 : 1.1;
      if (this.sample('deflect', variant === 'resist' ? .07 : .05, rate, .25, pan)) return;
      if (variant === 'strong') this.tone(2600, 1900, .06, .035, 'sine', null, pan);
      else if (variant === 'resist') this.tone(540, 380, .07, .045, 'triangle', null, pan);
      else this.tone(1500, 1100, .05, .028, variant === 'drone' ? 'triangle' : 'sine', null, pan);
    }
    if (type === 'pickup' || type === 'upgrade') {
      if (this.sample(type === 'upgrade' ? 'purchase' : 'pickup', type === 'upgrade' ? .24 : .38, 1, .6, pan)) return;
      [440, 660, 880].forEach((f, i) => this.tone(f, f * 1.002, .18, .12, 'sine', t + i * .07, pan));
    }
    // A two-tone klaxon announces the guardian.
    if (type === 'boss' && !this.sample('alarm', .3, 1, 1.5)) { for (let i = 0; i < 4; i++) this.tone(i % 2 ? 165 : 196, i % 2 ? 150 : 180, .28, .16, 'sawtooth', t + i * .3); }
    if (type === 'weapon' && !this.sample('weapon', .32, 1, .4)) this.tone(520, 860, .12, .07, 'triangle');
    if (type === 'combo') {
      // Bigger chains climb in pitch.
      const notes = variant === 'Rampage' ? [220, 330, 495, 660] : variant === 'Multi kill' ? [330, 495, 660] : [440, 660];
      if (!this.sample('combo', .3, notes.length === 4 ? 1.335 : notes.length === 3 ? 1.19 : 1, .4, pan * .5)) notes.forEach((f, i) => this.tone(f, f * 1.04, .15, .13, 'square', t + i * .055, pan * .5));
    }
    if (type === 'boss-open' && !this.sample('boss-open', .32, 1, .6)) this.tone(880, 1320, .28, .12, 'sine');
    if (type === 'boss-close') this.sample('boss-close', .22, 1, .6);
    if (type === 'weak-break') {
      if (!this.sample('weak-break', .5, 1, .6, pan, .2)) { this.burst(.16, .12, 4200, null, pan); this.tone(260, 920, .3, .16, 'sawtooth', null, pan); }
      this.sample('explosion', .3, 1.2, .8, pan, .2);
    }
    if (type === 'dive') {
      // The unmistakable falling whistle of a diving attacker.
      if (t - (this.lastDive || 0) < .12) return;
      this.lastDive = t;
      if (!this.sample('dive', .12, 1, .5, pan)) this.tone(1500, 420, .5, .045, 'sine', null, pan);
    }
    if (type === 'power' && !this.sample('power-up', .36, 1, .8, pan)) [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, f * 1.01, .14, .11, 'square', t + i * .05, pan));
    if (type === 'drone' && !this.sample('drone', .36, 1, .5, pan)) [523, 784, 1046, 1568].forEach((f, i) => this.tone(f, f, .2, .1, 'triangle', t + i * .07, pan));
    if (type === 'nova') {
      if (!this.sample('explosion-large', .75, .78, 1.6, 0, .6)) this.burst(1.3, .5, 2600, null, 0, .6);
      if (!this.sample('boom', .7, .85, 1.5, 0, .3)) { this.tone(160, 28, 1.1, .34, 'sine'); this.tone(900, 60, .8, .08, 'sawtooth'); }
      this.duck(.45, 1);
    }
    if (type === 'extra-life' && !this.sample('extra-life', .38, 1, 1.1)) [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, f, .16, .12, 'square', t + i * .09));
    if (type === 'squadron' && !this.sample('bonus', .32, 1, .5, pan)) { [659, 830, 988].forEach(f => this.tone(f, f * 1.02, .32, .07, 'triangle', null, pan)); this.tone(1318, 1320, .22, .05, 'sine', t + .08, pan); }
    if (type === 'tractor-charge' && !this.sample('tractor-charge', .22, 1, 1.1, pan)) this.tone(180, 520, .6, .07, 'sawtooth', null, pan);
    if (type === 'tractor' && !this.sample('tractor', .16, 1, 2.5, pan, 0, null, true)) this.warble(2.5, .07);
    if (type === 'captured' && !this.sample('power-down', .32, .8, .6, pan)) [620, 520, 410, 330].forEach((f, i) => this.tone(f, f * .96, .18, .1, 'square', t + i * .11, pan));
    if (type === 'rescue' && !this.sample('rescue', .34, 1, .6, pan)) [440, 554, 659, 880, 1108].forEach((f, i) => this.tone(f, f, .16, .11, 'triangle', t + i * .06, pan));
    if (type === 'respawn') {
      if (!this.sample('respawn', .32, 1, .5)) { this.tone(220, 880, .55, .09, 'triangle'); this.burst(.3, .05, 5200); }
      this.sample('shield-up', .16, 1.2, .8);
    }
    if (type === 'beam-charge' && !this.sample('beam-charge', .22, 1, .9, pan)) this.tone(300, 1200, .7, .04, 'sine', null, pan);
    if (type === 'beam' && !this.sample('beam', .36, 1, .9, pan, .25)) { this.burst(.35, .16, 6000, null, pan, .25); this.tone(1100, 180, .35, .09, 'sawtooth', null, pan); }
    if (type === 'power-lost' && !this.sample('power-down', .3, 1, .5, pan)) this.tone(700, 220, .3, .09, 'square', null, pan);
    if ((type === 'midboss' || type === 'captor') && !this.sample('alert', .26, 1, .8)) [0, .22].forEach(offset => this.tone(240, 190, .2, .14, 'sawtooth', t + offset));
    if (type === 'wave' && size > 1 && !this.sample('notify', .1, 1, .4)) [587, 880].forEach((f, i) => this.tone(f, f, .16, .06, 'triangle', t + i * .09));
    if (type === 'challenge' && !this.sample('challenge', .3, 1, 1.1)) [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, .22, .1, 'triangle', t + i * .12));
    if (type === 'encounter') {
      // Opportunities chime upward; hazards and hunters warn with a low pulse.
      const calm = variant === 'convoy' || variant === 'bonusFlight';
      if (!(calm ? this.sample('notify', .12, 1.12, .4) : this.sample('alert', .2, .9, .8))) {
        (calm ? [659, 988, 1318] : [330, 262, 330]).forEach((f, i) => this.tone(f, f, calm ? .18 : .22, calm ? .08 : .11, calm ? 'triangle' : 'sawtooth', t + i * .11));
      }
    }
    if (type === 'objective' && !this.sample('objective', .22, 1, .6)) [659, 880, 1175, 1568].forEach((f, i) => this.tone(f, f, .2, .09, 'triangle', t + i * .08));
    if (type === 'checkpoint' && !this.sample('checkpoint', .14, 1, .6)) [523, 784].forEach((f, i) => this.tone(f, f * 1.005, .26, .07, 'sine', t + i * .14));
    if (type === 'graze') {
      // A faint high tick; grazes in quick succession climb in pitch.
      if (t - (this.lastGraze || 0) < .05) return;
      this.grazeStep = t - (this.lastGraze || 0) < .4 ? Math.min(6, (this.grazeStep || 0) + 1) : 0;
      this.lastGraze = t;
      const step = 2 ** (this.grazeStep / 12), pitch = 2200 * step;
      if (!this.sample('graze', .07, step, .1, pan)) this.tone(pitch, pitch * 1.2, .035, .018, 'sine', null, pan);
    }
    if (type === 'formation-broken' && !this.sample('bonus', .3, .89, .5, pan)) { [784, 622, 466].forEach((f, i) => this.tone(f, f * .98, .16, .08, 'square', t + i * .07, pan)); this.tone(1568, 1570, .2, .04, 'sine', t + .22, pan); }
    if (type === 'ace-down' && !this.sample('ace', .36, 1, 1, pan)) [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, f, .18, .11, 'square', t + i * .08, pan));
    if (type === 'split' && !this.sample('split', .26, 1, .4, pan)) { this.tone(980, 320, .14, .07, 'square', null, pan); this.burst(.1, .08, 5200, null, pan); }
    if (type === 'challenge-result') {
      const perfect = variant === 'perfect';
      if (!this.sample(perfect ? 'ace' : 'power-up', perfect ? .4 : .34, 1, 1)) {
        (perfect ? [523, 659, 784, 1046, 1318, 1568] : [392, 523, 659]).forEach((f, i) => this.tone(f, f, .22, .11, 'square', t + i * .1));
      }
    }
  }
  warble(duration, volume) {
    if (!this.context || this.muted) return;
    const t = this.context.currentTime, osc = this.context.createOscillator(), lfo = this.context.createOscillator();
    const depth = this.context.createGain(), gain = this.context.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(330, t);
    lfo.frequency.setValueAtTime(7, t); depth.gain.setValueAtTime(90, t);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(volume, t + .08);
    gain.gain.setValueAtTime(volume, t + duration - .2); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    lfo.connect(depth); depth.connect(osc.frequency); osc.connect(gain); gain.connect(this.master);
    this.trackSynth(osc, [gain]); this.trackSynth(lfo, [depth]);
    osc.start(t); lfo.start(t); osc.stop(t + duration + .02); lfo.stop(t + duration + .02);
  }
  update(playing, level = 0, mood = '', danger = 0) {
    if (!playing && this.active) this.pause();
    this.active = playing;
    this.updateMusic(playing, mood, level);
    if (!this.context || this.muted || !playing || this.context.state !== 'running') return;
    this.updateDanger(danger);
  }
}
