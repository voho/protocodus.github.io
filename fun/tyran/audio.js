// Asset loading finishes in preflight; flight playback only reads memory.
// The original synthesizer remains available for unavailable assets.
import { audioAssets, SAMPLE_GROUPS as SAMPLES, SONGS } from './audio-assets.js';
export { preloadAudio } from './audio-assets.js';

const FLIGHT_SONGS = Object.freeze(['flight', 'flight2', 'flight3']);

export class AudioEngine {
  constructor() {
    this.context = null; this.muted = false; this.active = false; this.beat = 0; this.nextBeat = 0; this.lastShot = 0;
    this.samples = audioAssets.samples; this.sampleVoices = new Set(); this.synthVoices = new Set(); this.lastSample = new Map();
    this.failedSongs = new Set(); this.songKey = 'flight'; this.musicPlaying = false; this.musicToken = 0;
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
        this.master = this.context.createGain(); this.master.gain.value = .34; this.master.connect(this.limiter); this.limiter.connect(this.context.destination);
        const length = this.context.sampleRate * 2;
        this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      this.nextBeat = this.context.currentTime;
      this.prepareMusic();
      this.musicBlocked = false;
      // Unlock the media element in the same gesture as AudioContext. Its gain
      // stays at zero until update confirms the arena is actually playing.
      this.playMusic();
    } catch { /* Audio is optional; gameplay continues on restricted browsers. */ }
  }
  mute(value) {
    this.muted = value;
    if (this.master) this.master.gain.setTargetAtTime(value ? 0 : .34, this.context.currentTime, .04);
    if (value) { this.stopMusic(); this.stopVoices(); }
  }
  pause() { this.active = false; this.stopMusic(); this.stopVoices(); }
  stopVoices() {
    for (const voice of [...this.sampleVoices, ...this.synthVoices]) {
      try { voice.source.stop(); } catch { /* Already ended. */ }
    }
    this.sampleVoices.clear(); this.synthVoices.clear();
  }
  trackSynth(source, nodes) {
    const voice = { source }; this.synthVoices.add(voice);
    source.onended = () => { this.synthVoices.delete(voice); source.disconnect(); nodes.forEach(node => node.disconnect()); };
  }
  sample(group, volume, rate = 1, maxDuration = 2) {
    const available = SAMPLES[group]?.filter(key => this.samples.has(key)) || [];
    if (!available.length) return false;
    const groupLimit = group.startsWith('laser') ? 5 : group === 'explosion' ? 4 : 3;
    if (this.sampleVoices.size >= 12 || [...this.sampleVoices].filter(voice => voice.group === group).length >= groupLimit) return true;
    const choices = available.filter(key => key !== this.lastSample.get(group));
    const pool = choices.length ? choices : available, key = pool[Math.floor(Math.random() * pool.length)];
    this.lastSample.set(group, key);
    const source = this.context.createBufferSource(), gain = this.context.createGain(), t = this.context.currentTime;
    source.buffer = this.samples.get(key); source.playbackRate.value = rate * (.96 + Math.random() * .08);
    const duration = Math.min(maxDuration, source.buffer.duration / source.playbackRate.value);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(volume, t + .004);
    gain.gain.setValueAtTime(volume, t + Math.max(.004, duration - .04)); gain.gain.linearRampToValueAtTime(0, t + duration);
    source.connect(gain); gain.connect(this.master);
    const voice = { source, group }; this.sampleVoices.add(voice);
    source.onended = () => { this.sampleVoices.delete(voice); source.disconnect(); gain.disconnect(); };
    source.start(t); source.stop(t + duration + .005);
    return true;
  }
  prepareMusic() {
    if (this.music || this.musicUnavailable || !audioAssets.ready || !audioAssets.songs.size) return;
    try {
      this.music = new Audio(); this.music.preload = 'none'; this.music.loop = true;
      this.musicGain = this.context.createGain(); this.musicGain.gain.value = 0; this.musicGain.connect(this.master);
      this.musicSource = this.context.createMediaElementSource(this.music); this.musicSource.connect(this.musicGain);
      this.music.addEventListener('playing', () => {
        this.musicPlaying = true;
        if (!this.active || this.muted) this.stopMusic();
      });
      this.music.addEventListener('waiting', () => { this.musicPlaying = false; });
      this.music.addEventListener('error', () => {
        this.failedSongs.add(this.songKey); this.stopMusic();
      });
      if (audioAssets.songs.has(this.songKey)) this.music.src = audioAssets.songs.get(this.songKey);
    } catch { this.musicUnavailable = true; this.music = null; }
  }
  playMusic() {
    if (!this.music || this.muted || this.musicBlocked || !audioAssets.songs.has(this.songKey) || this.failedSongs.has(this.songKey) || this.musicPending || !this.music.paused) return;
    const token = ++this.musicToken;
    this.musicPending = true;
    try {
      Promise.resolve(this.music.play()).catch(error => {
        if (token !== this.musicToken) return;
        // A rejected gesture/autoplay attempt can retry on the next start().
        // Unsupported or broken files use the synth for the rest of the visit.
        if (error?.name === 'NotAllowedError') this.musicBlocked = true;
        else if (error?.name !== 'AbortError') this.failedSongs.add(this.songKey);
        this.musicPlaying = false;
      }).finally(() => { if (token === this.musicToken) this.musicPending = false; });
    } catch { this.failedSongs.add(this.songKey); this.musicPending = false; }
  }
  stopMusic() {
    if (!this.music) return;
    this.musicToken++; this.musicPending = false; this.musicPlaying = false; this.music.pause();
    this.musicGain.gain.setValueAtTime(0, this.context.currentTime);
  }
  updateMusic(playing, mood, level = 0) {
    if (!this.music) return false;
    if (!playing || this.muted) { if (!this.music.paused || this.musicPending) this.stopMusic(); return false; }
    // Absolute sector order rotates the three flight tracks across every cycle.
    const sector = Number.isSafeInteger(level) && level >= 0 ? level : 0;
    const flight = FLIGHT_SONGS[sector % FLIGHT_SONGS.length];
    const key = mood === 'boss' || mood === 'challenge' ? mood : flight;
    if (key !== this.songKey) {
      this.stopMusic(); this.songKey = key;
      if (audioAssets.songs.has(key)) this.music.src = audioAssets.songs.get(key);
      else this.music.removeAttribute('src');
    }
    this.playMusic();
    this.musicGain.gain.setTargetAtTime(SONGS[key].gain, this.context.currentTime, .12);
    return this.musicPlaying && !this.music.paused && this.music.readyState >= 2;
  }
  tone(frequency, end, duration, volume, type = 'sine', when = null) {
    if (!this.context || this.muted) return;
    const t = when ?? this.context.currentTime, osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(Math.max(15, end), t + duration);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(volume, t + .008); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    this.trackSynth(osc, [gain]);
    osc.connect(gain); gain.connect(this.master); osc.start(t); osc.stop(t + duration + .02);
  }
  burst(duration, volume, cutoff = 600, when = null) {
    if (!this.context || this.muted) return;
    const t = when ?? this.context.currentTime, noise = this.context.createBufferSource(), gain = this.context.createGain(), filter = this.context.createBiquadFilter();
    noise.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.setValueAtTime(cutoff, t); filter.frequency.exponentialRampToValueAtTime(80, t + duration);
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    this.trackSynth(noise, [filter, gain]);
    noise.connect(filter); filter.connect(gain); gain.connect(this.master); noise.start(t); noise.stop(t + duration);
  }
  effect(type, size = 20, variant = '') {
    if (!this.context || this.muted || this.context.state !== 'running') return;
    const t = this.context.currentTime;
    if (type === 'shot') {
      if (t - this.lastShot < .045) return;
      this.lastShot = t;
      const group = variant === 'lance' || variant === 'plasma' ? 'laser-heavy' : variant === 'scatter' || variant === 'arc' ? 'laser-retro' : 'laser-small';
      const rate = { pulse: 1.12, scatter: .85, lance: 1.22, seeker: 1.32, plasma: .74, arc: 1.4 }[variant] || 1;
      if (this.sample(group, group === 'laser-heavy' ? .18 : .13, rate, group === 'laser-heavy' ? .38 : .22)) return;
      const pitch = { pulse: 1150, scatter: 760, lance: 410, seeker: 930, plasma: 260, arc: 1380 }[variant] || 1150;
      this.tone(pitch, Math.max(80, pitch * .2), variant === 'lance' ? .17 : .085, variant === 'plasma' ? .1 : .065, variant === 'arc' ? 'square' : 'triangle');
    }
    if (type === 'explosion') {
      // Simultaneous kills share one voice slot per 35 ms instead of stacking.
      if (t - (this.lastExplosion || 0) < .035 && size < 60) return;
      this.lastExplosion = t;
      if (this.sample('explosion', Math.min(.48, .16 + size / 280), Math.max(.72, 1.17 - size / 350), 1.4)) return;
      this.burst(Math.min(1.3, .18 + size / 130), Math.min(.5, .09 + size / 220), 1400); this.tone(90, 22, .25 + size / 220, .2);
    }
    if (type === 'hit') { if (this.sample('impact', .3, 1.15, .35)) return; this.burst(.13, .18, 3200); this.tone(420, 100, .2, .14, 'sawtooth'); }
    if (type === 'pickup' || type === 'upgrade') { if (this.sample('pickup', .25, type === 'upgrade' ? .92 : 1.12, .6)) return; [440, 660, 880].forEach((f, i) => this.tone(f, f * 1.002, .18, .12, 'sine', t + i * .07)); }
    if (type === 'boss') { [0, .3, .6].forEach(offset => this.tone(180, 140, .25, .18, 'sawtooth', t + offset)); }
    if (type === 'weapon') { if (this.sample('pickup', .16, 1.35, .32)) return; this.tone(520, 860, .12, .07, 'triangle'); }
    if (type === 'combo') { const notes = variant === 'Rampage' ? [220, 330, 495, 660] : variant === 'Multi kill' ? [330, 495, 660] : [440, 660]; notes.forEach((f, i) => this.tone(f, f * 1.04, .15, .13, 'square', t + i * .055)); }
    if (type === 'boss-open') { this.tone(880, 1320, .28, .12, 'sine'); }
    if (type === 'weak-break') { if (!this.sample('impact', .24, .85, .5)) this.burst(.16, .12, 4200); this.tone(260, 920, .3, .16, 'sawtooth'); }
    if (type === 'dive') {
      // The unmistakable falling whistle of a diving attacker.
      if (t - (this.lastDive || 0) < .12) return;
      this.lastDive = t; this.tone(1500, 420, .5, .045, 'sine');
    }
    if (type === 'power') { [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, f * 1.01, .14, .11, 'square', t + i * .05)); }
    if (type === 'drone') { [523, 784, 1046, 1568].forEach((f, i) => this.tone(f, f, .2, .1, 'triangle', t + i * .07)); }
    if (type === 'nova') { if (!this.sample('explosion', .5, .7, 1.6)) this.burst(1.3, .5, 2600); this.tone(160, 28, 1.1, .34, 'sine'); this.tone(900, 60, .8, .08, 'sawtooth'); }
    if (type === 'extra-life') { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, f, .16, .12, 'square', t + i * .09)); }
    if (type === 'squadron') { [659, 830, 988].forEach(f => this.tone(f, f * 1.02, .32, .07, 'triangle')); this.tone(1318, 1320, .22, .05, 'sine', t + .08); }
    if (type === 'tractor-charge') { this.tone(180, 520, .6, .07, 'sawtooth'); }
    if (type === 'tractor') this.warble(2.5, .07);
    if (type === 'captured') { [620, 520, 410, 330].forEach((f, i) => this.tone(f, f * .96, .18, .1, 'square', t + i * .11)); }
    if (type === 'rescue') { [440, 554, 659, 880, 1108].forEach((f, i) => this.tone(f, f, .16, .11, 'triangle', t + i * .06)); }
    if (type === 'respawn') { this.tone(220, 880, .55, .09, 'triangle'); this.burst(.3, .05, 5200); }
    if (type === 'beam-charge') { this.tone(300, 1200, .7, .04, 'sine'); }
    if (type === 'beam') { this.burst(.35, .16, 6000); this.tone(1100, 180, .35, .09, 'sawtooth'); }
    if (type === 'power-lost') { this.tone(700, 220, .3, .09, 'square'); }
    if (type === 'midboss' || type === 'captor') { [0, .22].forEach(offset => this.tone(240, 190, .2, .14, 'sawtooth', t + offset)); }
    if (type === 'wave' && size > 1) { [587, 880].forEach((f, i) => this.tone(f, f, .16, .06, 'triangle', t + i * .09)); }
    if (type === 'challenge') { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, .22, .1, 'triangle', t + i * .12)); }
    if (type === 'challenge-result') {
      const notes = variant === 'perfect' ? [523, 659, 784, 1046, 1318, 1568] : [392, 523, 659];
      notes.forEach((f, i) => this.tone(f, f, .22, .11, 'square', t + i * .1));
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
  update(playing, level = 0, mood = '') {
    if (!playing && this.active) this.pause();
    this.active = playing;
    const streamedMusic = this.updateMusic(playing, mood, level);
    if (!this.context || this.muted || !playing || this.context.state !== 'running') return;
    if (streamedMusic) { this.nextBeat = this.context.currentTime; return; }
    const now = this.context.currentTime;
    if (this.nextBeat < now - .5) this.nextBeat = now;
    // Challenge stages switch to a bright major loop; guardians push the tempo.
    const challenge = mood === 'challenge', boss = mood === 'boss';
    const notes = challenge ? [65.41, 65.41, 82.41, 98, 87.31, 87.31, 98, 110] : [55, 55, 82.41, 65.41, 55, 73.42, 65.41, 49];
    const arps = challenge ? [4, 5, 6, 8, 6, 5, 8, 10] : [4, 6, 8, 12, 8, 6, 9, 8];
    while (this.nextBeat < now + .13) {
      const beat = this.beat++, t = this.nextBeat, root = notes[Math.floor(beat / 4) % notes.length] * 2 ** (level % 3 / 12);
      this.tone(root, root, .2, .105, 'triangle', t);
      if (beat % 4 === 0) this.tone(120, 35, .18, .3, 'sine', t);
      if (beat % 4 === 2) this.burst(.095, .07, 4800, t);
      if (beat % 2 === 1 || boss) this.burst(.025, .035, 11000, t);
      const arp = arps[beat % 8];
      this.tone(root * arp, root * arp, .17, challenge ? .034 : .023, challenge ? 'square' : 'sine', t);
      this.nextBeat += boss ? .128 : .145;
    }
  }
}
