/* Meteora — the score, played live.

   No recordings: a handful of Web Audio voices — a pad of detuned saws, a
   sub, a bass line, kick, snare and hats made of noise and sine, an
   arpeggio through a delay, and high pings for the quiet missions —
   scheduled a fraction of a second ahead on the audio clock, so a slow
   frame never makes them stumble.

   The mood sets which layers play, how fast, and through which chords:

     menu      the pad alone, slow, warm: the belt at rest
     calm      pad and a soft pulse — patrols, the flight home
     stealth   a dark pad, a sub, distant pings — the Deep
     tension   pad, bass and a heartbeat kick — something is coming
     combat    drums, a driving bass, the pad underneath
     climax    everything, faster, with the arpeggio on top
     victory   the progression turns major and resolves
     defeat    minor, slowing, fading

   Missions choose the mood; on top of that, Harrow ships closing on the
   player lift a calm or tense mission into combat until the sky clears. */

const MOODS = {
  menu: { bpm: 68, chords: 'calm', layers: { pad: 0.5, sub: 0.25 } },
  calm: { bpm: 80, chords: 'calm', layers: { pad: 0.42, sub: 0.25, bass: 0.18, hat: 0.05 } },
  stealth: { bpm: 72, chords: 'dark', layers: { pad: 0.22, sub: 0.38, ping: 0.32 } },
  tension: { bpm: 96, chords: 'tension', layers: { pad: 0.36, sub: 0.3, bass: 0.36, kick: 0.38, hat: 0.12 } },
  combat: { bpm: 112, chords: 'combat', layers: { pad: 0.32, sub: 0.2, bass: 0.46, kick: 0.55, snare: 0.4, hat: 0.3 } },
  climax: { bpm: 124, chords: 'climax', layers: { pad: 0.38, sub: 0.25, bass: 0.5, kick: 0.6, snare: 0.5, hat: 0.34, arp: 0.32 } },
  victory: { bpm: 76, chords: 'victory', layers: { pad: 0.55, sub: 0.3, arp: 0.18 } },
  defeat: { bpm: 60, chords: 'defeat', layers: { pad: 0.45, sub: 0.3 } },
};
// Chords as MIDI notes; the root of each is the bass note.
const PROGRESSIONS = {
  calm: [[50, 57, 60, 64, 69], [46, 53, 57, 62, 65], [41, 48, 57, 60, 64], [48, 55, 59, 64, 67]],
  dark: [[38, 50, 53, 57], [38, 50, 52, 57], [34, 46, 50, 53], [36, 48, 51, 55]],
  tension: [[38, 50, 53, 57], [34, 46, 53, 58], [31, 43, 50, 55], [33, 45, 52, 57]],
  combat: [[38, 50, 53, 57], [36, 48, 52, 55], [34, 46, 50, 53], [33, 45, 49, 52]],
  climax: [[38, 50, 53, 57, 62], [34, 46, 50, 53, 58], [36, 48, 52, 55, 60], [33, 45, 49, 52, 57]],
  victory: [[41, 53, 57, 60, 65], [36, 48, 52, 55, 64], [38, 50, 53, 57, 62], [46, 53, 58, 62, 65], [41, 53, 57, 60, 69]],
  defeat: [[38, 50, 53, 57], [34, 46, 49, 53], [31, 43, 46, 50], [33, 45, 48, 52]],
};
const KICK = { tension: [0, 8], combat: [0, 6, 8, 14], climax: [0, 4, 8, 12] };
const SNARE = { combat: [4, 12], climax: [4, 12] };
const hz = n => 440 * Math.pow(2, (n - 69) / 12);

export function createMusic(audio, volume = 0.6) {
  let ctx = null, out = null, level = volume, mood = 'menu', base = 'menu', heat = 0;
  let noise = null, layers = null, delay = null;
  let nextStep = 0, step = 0, chord = 0, timer = null, pad = null, sub = null;

  function build() {
    ctx = audio.ctx;
    if (!ctx || out) return;
    out = ctx.createGain(); out.gain.value = level * level * 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    out.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    layers = Object.fromEntries(['pad', 'sub', 'bass', 'kick', 'snare', 'hat', 'arp', 'ping'].map(k => {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(out); return [k, g];
    }));
    delay = ctx.createDelay(1);
    delay.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    delay.connect(dl).connect(fb).connect(delay);
    dl.connect(out);
    layers.arp.connect(delay); layers.ping.connect(delay);
    // The pad: five detuned saw pairs through a slowly breathing lowpass.
    const padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 900; padF.Q.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 350;
    lfo.connect(lfoG).connect(padF.frequency); lfo.start();
    padF.connect(layers.pad);
    pad = { filter: padF, voices: Array.from({ length: 5 }, (_, k) => {
      const g = ctx.createGain(); g.gain.value = 0.11;
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = 'sawtooth'; b.type = 'sawtooth'; a.detune.value = -7 - k; b.detune.value = 7 + k;
      a.connect(g); b.connect(g); g.connect(padF); a.start(); b.start();
      return { a, b };
    }) };
    const s = ctx.createOscillator(); s.type = 'sine';
    const sg = ctx.createGain(); sg.gain.value = 0.5;
    s.connect(sg).connect(layers.sub); s.start();
    sub = s;
    nextStep = ctx.currentTime + 0.1;
    setChord(ctx.currentTime);
    applyMood(ctx.currentTime);
    timer = setInterval(schedule, 25);
  }

  const glide = (param, value, at, tau = 0.8) => param.setTargetAtTime(value, at, tau);
  function setChord(at) {
    const prog = PROGRESSIONS[MOODS[mood].chords];
    const c = prog[chord % prog.length];
    pad.voices.forEach((v, k) => {
      const n = c[Math.min(k + 1, c.length - 1)] + (k + 1 >= c.length ? 12 : 0);
      glide(v.a.frequency, hz(n), at, 0.6); glide(v.b.frequency, hz(n), at, 0.6);
    });
    glide(sub.frequency, hz(c[0] - 12 < 28 ? c[0] : c[0] - 12), at, 0.4);
  }
  function applyMood(at) {
    const L = MOODS[mood].layers;
    for (const [k, g] of Object.entries(layers)) glide(g.gain, L[k] ?? 0, at, 1.2);
    glide(pad.filter.frequency, mood === 'stealth' || mood === 'defeat' ? 500 : mood === 'climax' ? 1600 : 1000, at, 2);
  }

  /* ---------- the drum machine and the bass ---------- */

  function hit(dest, at, { freq = 50, drop = 120, decay = 0.25, gain = 0.9, type = 'sine' }) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq + drop, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq), at + 0.08);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, at + decay);
    o.connect(g).connect(dest); o.start(at); o.stop(at + decay + 0.05);
  }
  function hiss(dest, at, { decay = 0.05, gain = 0.4, freq = 8000, type = 'highpass', q = 0.7 }) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; s.playbackRate.value = 1;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, at + decay);
    s.connect(f).connect(g).connect(dest);
    s.start(at, Math.random() * 0.8); s.stop(at + decay + 0.05);
  }
  function note(dest, at, n, length, { type = 'sawtooth', cutoff = 700, gain = 0.4, q = 4 } = {}) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = type; o.frequency.value = hz(n);
    f.type = 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(cutoff * 3, at); f.frequency.exponentialRampToValueAtTime(cutoff, at + length * 0.7);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + 0.008);
    g.gain.setTargetAtTime(0, at + length * 0.6, length * 0.25);
    o.connect(f).connect(g).connect(dest); o.start(at); o.stop(at + length + 0.4);
  }

  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const M = MOODS[mood], L = M.layers;
    const sixteenth = 60 / M.bpm / 4;
    while (nextStep < ctx.currentTime + 0.12) {
      const at = nextStep, s = step % 16;
      const prog = PROGRESSIONS[M.chords];
      const c = prog[chord % prog.length];
      if (L.kick && (KICK[mood] ?? []).includes(s)) hit(layers.kick, at, { freq: 46, drop: 110, decay: 0.32 });
      if (L.snare && (SNARE[mood] ?? []).includes(s)) { hiss(layers.snare, at, { decay: 0.16, gain: 0.5, freq: 1800, type: 'bandpass', q: 0.8 }); hit(layers.snare, at, { freq: 180, drop: 60, decay: 0.09, gain: 0.35, type: 'triangle' }); }
      if (L.hat && (mood === 'climax' ? true : s % 2 === 0)) hiss(layers.hat, at, { decay: s % 4 === 2 ? 0.07 : 0.035, gain: s % 4 === 2 ? 0.32 : 0.18 });
      if (L.bass) {
        const root = c[0] < 36 ? c[0] + 12 : c[0];
        if (mood === 'climax') note(layers.bass, at, root + (s % 4 === 3 ? 7 : 0), sixteenth * 0.9, { cutoff: 520 });
        else if (mood === 'combat') { if (s % 2 === 0) note(layers.bass, at, root + ([0, 0, 0, 7, 0, 0, 12, 0][s / 2] ?? 0), sixteenth * 1.8, { cutoff: 480 }); }
        else if (mood === 'tension') { if (s === 0 || s === 8 || s === 10) note(layers.bass, at, root, sixteenth * 3.5, { cutoff: 380 }); }
        else if (s === 0) note(layers.bass, at, root, sixteenth * 12, { cutoff: 300, gain: 0.3 });
      }
      if (L.arp) {
        const tones = c.slice(1);
        const k = mood === 'victory' ? s % tones.length : [0, 1, 2, 3, 2, 1][s % 6] % tones.length;
        if (mood !== 'victory' || s % 2 === 0) note(layers.arp, at, tones[k] + 12, sixteenth * 0.8, { type: 'triangle', cutoff: 2400, gain: 0.25, q: 1 });
      }
      if (L.ping && s === 0 && Math.random() < 0.45) note(layers.ping, at + Math.random() * 0.3, c[1 + Math.floor(Math.random() * (c.length - 1))] + 24, 1.6, { type: 'sine', cutoff: 4000, gain: 0.18, q: 0.5 });
      step++;
      nextStep += sixteenth;
      if (step % 32 === 0) { chord++; setChord(at); }
    }
  }

  function setMood(next, { force = false } = {}) {
    if (!MOODS[next]) return;
    base = next;
    if (!force && heat > 0.5 && (next === 'calm' || next === 'tension' || next === 'stealth')) next = 'combat';
    if (next === mood) return;
    mood = next;
    if (ctx && pad) { const at = ctx.currentTime; chord = 0; setChord(at); applyMood(at); }
  }

  return {
    start() { if (!ctx) build(); },
    setVolume(v) { level = v; if (out) glide(out.gain, v * v * 0.8, ctx.currentTime, 0.1); },
    setMood,
    get mood() { return mood; },
    /* Lift the score into combat while the Harrow are close. */
    update(world, dt) {
      if (!ctx && audio.ctx) build();
      if (!ctx || !world?.player) return;
      const p = world.player;
      let near = false;
      if (world.state === 'flying' && p.alive) {
        for (const e of world.entities) {
          if (e.team !== 1 || !e.alive || e.frozen || e.role === 'sentry' || e.role === 'seed' || e.role === 'anchor') continue;
          const d = Math.hypot(e.ship.pos[0] - p.ship.pos[0], e.ship.pos[1] - p.ship.pos[1], e.ship.pos[2] - p.ship.pos[2]);
          if (d < (e.big ? 3500 : 1600)) { near = true; break; }
        }
      }
      heat = near ? Math.min(1, heat + dt * 0.8) : Math.max(0, heat - dt / 9);
      const lifted = heat > 0.5 && (base === 'calm' || base === 'tension' || base === 'stealth') ? 'combat' : base;
      if (lifted !== mood) { mood = lifted; const at = ctx.currentTime; chord = 0; setChord(at); applyMood(at); }
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
