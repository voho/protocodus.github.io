// Original synthesized soundtrack and effects; no downloads or autoplay.
export class AudioEngine {
  constructor() { this.context = null; this.muted = false; this.active = false; this.beat = 0; this.nextBeat = 0; this.lastShot = 0; }
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
    } catch { /* Audio is optional; gameplay continues on restricted browsers. */ }
  }
  mute(value) { this.muted = value; if (this.master) this.master.gain.setTargetAtTime(value ? 0 : .34, this.context.currentTime, .04); }
  tone(frequency, end, duration, volume, type = 'sine', when = null) {
    if (!this.context || this.muted) return;
    const t = when ?? this.context.currentTime, osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(Math.max(15, end), t + duration);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(volume, t + .008); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(t); osc.stop(t + duration + .02);
  }
  burst(duration, volume, cutoff = 600, when = null) {
    if (!this.context || this.muted) return;
    const t = when ?? this.context.currentTime, noise = this.context.createBufferSource(), gain = this.context.createGain(), filter = this.context.createBiquadFilter();
    noise.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.setValueAtTime(cutoff, t); filter.frequency.exponentialRampToValueAtTime(80, t + duration);
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    noise.connect(filter); filter.connect(gain); gain.connect(this.master); noise.start(t); noise.stop(t + duration);
  }
  effect(type, size = 20, variant = '') {
    if (!this.context || this.muted) return;
    const t = this.context.currentTime;
    if (type === 'shot') {
      if (t - this.lastShot < .045) return;
      this.lastShot = t;
      const pitch = { pulse: 1150, scatter: 760, lance: 410, seeker: 930, plasma: 260, arc: 1380 }[variant] || 1150;
      this.tone(pitch, Math.max(80, pitch * .2), variant === 'lance' ? .17 : .085, variant === 'plasma' ? .1 : .065, variant === 'arc' ? 'square' : 'triangle');
    }
    if (type === 'explosion') {
      // Simultaneous kills share one voice slot per 35 ms instead of stacking.
      if (t - (this.lastExplosion || 0) < .035 && size < 60) return;
      this.lastExplosion = t;
      this.burst(Math.min(1.3, .18 + size / 130), Math.min(.5, .09 + size / 220), 1400); this.tone(90, 22, .25 + size / 220, .2);
    }
    if (type === 'hit') { this.burst(.13, .18, 3200); this.tone(420, 100, .2, .14, 'sawtooth'); }
    if (type === 'turret-shot') { this.tone(340, 85, .09, .075, 'triangle'); this.burst(.045, .045, 1800); }
    if (type === 'pickup' || type === 'upgrade') { [440, 660, 880].forEach((f, i) => this.tone(f, f * 1.002, .18, .12, 'sine', t + i * .07)); }
    if (type === 'boss') { [0, .3, .6].forEach(offset => this.tone(180, 140, .25, .18, 'sawtooth', t + offset)); }
    if (type === 'weapon') { this.tone(520, 860, .12, .07, 'triangle'); }
    if (type === 'combo') { const notes = variant === 'Rampage' ? [220, 330, 495, 660] : variant === 'Multi kill' ? [330, 495, 660] : [440, 660]; notes.forEach((f, i) => this.tone(f, f * 1.04, .15, .13, 'square', t + i * .055)); }
    if (type === 'boss-open') { this.tone(880, 1320, .28, .12, 'sine'); }
    if (type === 'weak-break') { this.burst(.16, .12, 4200); this.tone(260, 920, .3, .16, 'sawtooth'); }
    if (type === 'dive') {
      // The unmistakable falling whistle of a diving attacker.
      if (t - (this.lastDive || 0) < .12) return;
      this.lastDive = t; this.tone(1500, 420, .5, .045, 'sine');
    }
    if (type === 'power') { [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, f * 1.01, .14, .11, 'square', t + i * .05)); }
    if (type === 'drone') { [523, 784, 1046, 1568].forEach((f, i) => this.tone(f, f, .2, .1, 'triangle', t + i * .07)); }
    if (type === 'nova') { this.burst(1.3, .5, 2600); this.tone(160, 28, 1.1, .34, 'sine'); this.tone(900, 60, .8, .08, 'sawtooth'); }
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
    osc.start(t); lfo.start(t); osc.stop(t + duration + .02); lfo.stop(t + duration + .02);
  }
  update(playing, level = 0, mood = '') {
    if (!this.context || this.muted || !playing || this.context.state !== 'running') return;
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
