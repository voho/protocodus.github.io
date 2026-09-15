// Original synthesized soundtrack and effects; no downloads or autoplay.
export class AudioEngine {
  constructor() { this.context = null; this.muted = false; this.active = false; this.beat = 0; this.nextBeat = 0; this.lastShot = 0; }
  start() {
    try {
      if (!this.context) {
        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.context.createGain(); this.master.gain.value = .34; this.master.connect(this.context.destination);
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
    if (type === 'explosion') { this.burst(Math.min(1.3, .18 + size / 130), Math.min(.5, .09 + size / 220), 1400); this.tone(90, 22, .25 + size / 220, .2); }
    if (type === 'hit') { this.burst(.13, .18, 3200); this.tone(420, 100, .2, .14, 'sawtooth'); }
    if (type === 'pickup' || type === 'upgrade') { [440, 660, 880].forEach((f, i) => this.tone(f, f * 1.002, .18, .12, 'sine', t + i * .07)); }
    if (type === 'boss') { [0, .3, .6].forEach(offset => this.tone(180, 140, .25, .18, 'sawtooth', t + offset)); }
    if (type === 'weapon') { this.tone(520, 860, .12, .07, 'triangle'); }
    if (type === 'combo') { const notes = variant === 'RAMPAGE' ? [220, 330, 495, 660] : variant === 'MULTI KILL' ? [330, 495, 660] : [440, 660]; notes.forEach((f, i) => this.tone(f, f * 1.04, .15, .13, 'square', t + i * .055)); }
    if (type === 'boss-open') { this.tone(880, 1320, .28, .12, 'sine'); }
    if (type === 'weak-break') { this.burst(.16, .12, 4200); this.tone(260, 920, .3, .16, 'sawtooth'); }
  }
  update(playing, level = 0) {
    if (!this.context || this.muted || !playing || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (this.nextBeat < now - .5) this.nextBeat = now;
    const notes = [55, 55, 82.41, 65.41, 55, 73.42, 65.41, 49];
    while (this.nextBeat < now + .13) {
      const beat = this.beat++, t = this.nextBeat, root = notes[Math.floor(beat / 4) % notes.length] * 2 ** (level % 3 / 12);
      this.tone(root, root, .2, .105, 'triangle', t);
      if (beat % 4 === 0) this.tone(120, 35, .18, .3, 'sine', t);
      if (beat % 4 === 2) this.burst(.095, .07, 4800, t);
      if (beat % 2 === 1) this.burst(.025, .035, 11000, t);
      const arp = [4, 6, 8, 12, 8, 6, 9, 8][beat % 8];
      this.tone(root * arp, root * arp, .17, .023, 'sine', t);
      this.nextBeat += .145;
    }
  }
}
