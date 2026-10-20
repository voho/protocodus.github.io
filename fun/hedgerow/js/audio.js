/* Hedgerow — procedural sound (Web Audio).

   Nothing is downloaded: the rain bed, wind, thunder, gunfire, bullets
   cracking past, impacts, footsteps, reloads and explosions are built from
   filtered noise and short oscillator sweeps. World sounds are panned and
   attenuated by distance from the listener and lose their highs with
   distance; gunfire carries a short slap-back echo from the houses and the
   tree line. */

import { rng } from './util.js';

export function createAudio() {
  let ctx = null, master = null, sfx = null, amb = null, verb = null;
  let noiseBuf = null, brownBuf = null;
  let volume = 0.8;
  const R = rng(77);
  const listener = { x: 0, y: 0, z: 0, yaw: 0 };
  let rainGain = null, windGain = null, rainLP = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    master.connect(comp).connect(ctx.destination);
    sfx = ctx.createGain(); sfx.connect(master);
    amb = ctx.createGain(); amb.connect(master);
    // outdoor slap-back: two short delays, filtered
    verb = ctx.createGain(); verb.gain.value = 0.32;
    const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1);
    d1.delayTime.value = 0.11; d2.delayTime.value = 0.27;
    const f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = 2200;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    verb.connect(f1); f1.connect(d1); f1.connect(d2);
    d1.connect(master); d2.connect(fb); fb.connect(d1); d2.connect(master);

    const n = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = R() * 2 - 1;
    brownBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const bc = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (R() * 2 - 1)) / 1.02; bc[i] = last * 3.5; }
    startAmbience();
  }

  function noise(brown = false) {
    const s = ctx.createBufferSource();
    s.buffer = brown ? brownBuf : noiseBuf;
    s.loop = true;
    s.loopStart = R() * 1.5;
    return s;
  }

  function startAmbience() {
    // rain: broadband hiss + patter
    const r = noise();
    rainLP = ctx.createBiquadFilter(); rainLP.type = 'lowpass'; rainLP.frequency.value = 5200;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    rainGain = ctx.createGain(); rainGain.gain.value = 0.16;
    r.connect(hp).connect(rainLP).connect(rainGain).connect(amb);
    r.start(0, R());
    const r2 = noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6;
    const g2 = ctx.createGain(); g2.gain.value = 0.07;
    r2.connect(bp).connect(g2).connect(amb);
    r2.start(0, R());
    // wind
    const w = noise(true);
    const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 380;
    windGain = ctx.createGain(); windGain.gain.value = 0.18;
    w.connect(wl).connect(windGain).connect(amb);
    w.start(0, R());
    // slow gust modulation
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.08;
    lfo.connect(lg).connect(windGain.gain);
    lfo.start();
  }

  /* Spatial chain for a sound at a world position. Returns the input node
     or null when it is too far to hear. */
  function spatial(x, y, z, { ref = 6, max = 400, echo = 0, lowpassFar = true } = {}) {
    const dx = x - listener.x, dy = y - listener.y, dz = z - listener.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > max) return null;
    const g = ctx.createGain();
    g.gain.value = Math.min(1.5, ref / Math.max(ref, d) ** 1.0) * (1 - d / max);
    const pan = ctx.createStereoPanner();
    // angle relative to the listener's facing
    const ang = Math.atan2(dx, dz) - listener.yaw;
    pan.pan.value = Math.max(-1, Math.min(1, -Math.sin(ang) * Math.min(1, d / 3)));
    let head = g;
    if (lowpassFar) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.max(700, 16000 / (1 + d / 18));
      g.connect(lp); lp.connect(pan);
    } else g.connect(pan);
    pan.connect(sfx);
    if (echo > 0) {
      const e = ctx.createGain(); e.gain.value = echo * Math.min(1, 0.4 + d / 60);
      pan.connect(e); e.connect(verb);
    }
    return head;
  }

  function env(gainNode, t0, attack, peak, decay, curve = 'exp') {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.linearRampToValueAtTime(peak, t0 + attack);
    if (curve === 'exp') g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    else g.linearRampToValueAtTime(0, t0 + attack + decay);
  }

  function burst(out, t, { dur = 0.2, peak = 1, type = 'lowpass', freq = 3000, q = 0.7, sweepTo = null, brown = false, attack = 0.002 } = {}) {
    const s = noise(brown);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    env(g, t, attack, peak, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, R() * 1.5);
    s.stop(t + dur + attack + 0.05);
  }

  function tone(out, t, { f0 = 120, f1 = 40, dur = 0.2, peak = 1, type = 'sine' } = {}) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    env(g, t, 0.003, peak, dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---------- weapons ---------- */

  const GUN = {
    garand: { crack: 1.0, freq: 2600, body: 1.1, low: 95, dur: 0.22, echo: 0.9 },
    thompson: { crack: 0.7, freq: 1800, body: 0.9, low: 80, dur: 0.14, echo: 0.6 },
    kar98k: { crack: 1.0, freq: 2400, body: 1.1, low: 90, dur: 0.24, echo: 0.9 },
    mp40: { crack: 0.65, freq: 1700, body: 0.8, low: 85, dur: 0.12, echo: 0.55 },
    mg42: { crack: 0.75, freq: 2100, body: 0.9, low: 75, dur: 0.1, echo: 0.6 },
  };

  function gunshot(kind, x, y, z, { player = false } = {}) {
    if (!ctx) return;
    const p = GUN[kind] || GUN.kar98k;
    const t = ctx.currentTime + 0.001;
    const out = player ? sfx : spatial(x, y, z, { ref: 8, max: 600, echo: p.echo });
    if (!out) return;
    let o = out;
    if (player) {
      const g = ctx.createGain(); g.gain.value = 0.9; g.connect(sfx);
      const e = ctx.createGain(); e.gain.value = p.echo * 0.6; g.connect(e); e.connect(verb);
      o = g;
    }
    burst(o, t, { dur: p.dur * 0.35, peak: p.crack, type: 'highpass', freq: p.freq, q: 0.5 });
    burst(o, t, { dur: p.dur, peak: p.body * 0.9, type: 'lowpass', freq: 1800, sweepTo: 300, q: 0.8 });
    tone(o, t, { f0: p.low * 1.6, f1: p.low * 0.4, dur: p.dur * 0.9, peak: p.body * 0.9 });
  }

  function garandPing() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.06;
    for (const [f, a] of [[2760, 0.16], [4150, 0.08], [5800, 0.04]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); env(g, t, 0.002, a, 0.5);
      o.connect(g).connect(sfx); o.start(t); o.stop(t + 0.6);
    }
  }

  function dryFire() {
    if (!ctx) return;
    burst(sfx, ctx.currentTime, { dur: 0.03, peak: 0.25, type: 'bandpass', freq: 3500, q: 2 });
  }

  /* Reload clicks: the player's own, or someone else's at a position. */
  function reload(kind, at = null) {
    if (!ctx) return;
    const out = at ? spatial(at.x, at.y + 1.2, at.z, { ref: 2, max: 30 }) : sfx;
    if (!out) return;
    const t = ctx.currentTime;
    const clicks = kind === 'garand' ? [0.2, 0.75, 1.45, 1.85] : [0.25, 0.85, 1.6, 2.05];
    clicks.forEach((dt, i) => burst(out, t + dt, { dur: 0.05, peak: 0.25 + (i === clicks.length - 1 ? 0.15 : 0), type: 'bandpass', freq: 2200 + i * 500, q: 3 }));
  }

  function switchWeapon() {
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(sfx, t, { dur: 0.08, peak: 0.15, type: 'bandpass', freq: 900, q: 1.5 });
    burst(sfx, t + 0.12, { dur: 0.04, peak: 0.2, type: 'bandpass', freq: 2600, q: 3 });
  }

  /* A bullet passing close: a sharp supersonic crack and a whip. */
  function whizz(x, y, z, closeness = 1) {
    if (!ctx) return;
    const out = spatial(x, y, z, { ref: 2, max: 30, lowpassFar: false });
    if (!out) return;
    const t = ctx.currentTime;
    burst(out, t, { dur: 0.05, peak: 0.6 * closeness, type: 'highpass', freq: 3500, q: 0.7 });
    burst(out, t + 0.01, { dur: 0.12, peak: 0.3 * closeness, type: 'bandpass', freq: 5000, sweepTo: 1500, q: 2 });
  }

  function impact(x, y, z, surface) {
    if (!ctx) return;
    const out = spatial(x, y, z, { ref: 3, max: 80 });
    if (!out) return;
    const t = ctx.currentTime;
    if (surface === 'metal') {
      tone(out, t, { f0: 1800 + R() * 900, f1: 1400, dur: 0.18, peak: 0.25, type: 'triangle' });
      burst(out, t, { dur: 0.04, peak: 0.3, type: 'highpass', freq: 3000 });
    } else if (surface === 'water') {
      burst(out, t, { dur: 0.18, peak: 0.35, type: 'bandpass', freq: 1200, sweepTo: 600, q: 1 });
    } else if (surface === 'wood') {
      burst(out, t, { dur: 0.08, peak: 0.4, type: 'bandpass', freq: 900, q: 1.5 });
    } else if (surface === 'flesh') {
      burst(out, t, { dur: 0.08, peak: 0.45, type: 'lowpass', freq: 700, q: 1 });
    } else if (surface === 'stone' || surface === 'cobble' || surface === 'concrete') {
      burst(out, t, { dur: 0.06, peak: 0.4, type: 'bandpass', freq: 2400, q: 1.2 });
    } else {
      burst(out, t, { dur: 0.1, peak: 0.35, type: 'lowpass', freq: 600, q: 0.7 });
    }
  }

  function explosion(x, y, z, scale = 1) {
    if (!ctx) return;
    const out = spatial(x, y, z, { ref: 12, max: 900, echo: 1.2 });
    if (!out) return;
    const t = ctx.currentTime;
    burst(out, t, { dur: 0.25, peak: 1.4 * scale, type: 'lowpass', freq: 5000, sweepTo: 800 });
    burst(out, t, { dur: 1.8, peak: 1.2 * scale, type: 'lowpass', freq: 600, sweepTo: 80, brown: true });
    tone(out, t, { f0: 70, f1: 25, dur: 1.2, peak: 1.4 * scale });
    // debris patter
    for (let i = 0; i < 6; i++) burst(out, t + 0.5 + R() * 1.2, { dur: 0.05, peak: 0.12, type: 'bandpass', freq: 1500 + R() * 2000, q: 2 });
  }

  function thunder({ delay = 3, power = 1 } = {}) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const g = ctx.createGain(); g.connect(amb);
    if (power > 1.2) burst(g, t, { dur: 0.35, peak: 0.9 * power, type: 'lowpass', freq: 3000, sweepTo: 400 });
    for (let i = 0; i < 5; i++) {
      burst(g, t + i * (0.35 + R() * 0.6), { dur: 1.6 + R() * 2.2, peak: (0.55 - i * 0.07) * power, type: 'lowpass', freq: 380 - i * 40, sweepTo: 60, brown: true, attack: 0.15 });
    }
  }

  /* Distant war: artillery thumps and far machine-gun bursts. */
  function distant(kind) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0.35; g.connect(amb);
    if (kind === 'artillery') {
      tone(g, t, { f0: 55, f1: 28, dur: 1.5, peak: 0.6 });
      burst(g, t, { dur: 2.2, peak: 0.4, type: 'lowpass', freq: 220, sweepTo: 60, brown: true, attack: 0.05 });
    } else {
      const n = 6 + Math.floor(R() * 10);
      for (let i = 0; i < n; i++) burst(g, t + i * 0.055, { dur: 0.06, peak: 0.18, type: 'lowpass', freq: 900, q: 0.7 });
    }
  }

  function footstep(x, y, z, surface, loud = 1, player = false) {
    if (!ctx) return;
    const out = player ? sfx : spatial(x, y, z, { ref: 2, max: 40 });
    if (!out) return;
    const t = ctx.currentTime;
    const gain = (player ? 0.22 : 0.3) * loud;
    if (surface === 'water') {
      burst(out, t, { dur: 0.22, peak: gain * 1.4, type: 'bandpass', freq: 900, sweepTo: 400, q: 0.9 });
    } else if (surface === 'mud' || surface === 'forest' || surface === 'grass') {
      burst(out, t, { dur: 0.12, peak: gain, type: 'lowpass', freq: 650, q: 1.2 });
      burst(out, t + 0.03, { dur: 0.08, peak: gain * 0.4, type: 'bandpass', freq: 1800, q: 2 });
    } else {
      burst(out, t, { dur: 0.06, peak: gain * 1.1, type: 'bandpass', freq: 1300, q: 1.5 });
    }
  }

  function pin() {
    if (!ctx) return;
    const t = ctx.currentTime;
    burst(sfx, t, { dur: 0.04, peak: 0.3, type: 'bandpass', freq: 3200, q: 4 });
    tone(sfx, t + 0.05, { f0: 3000, f1: 2500, dur: 0.15, peak: 0.08, type: 'triangle' });
  }

  function grenadeBounce(x, y, z) {
    if (!ctx) return;
    const out = spatial(x, y, z, { ref: 3, max: 40 });
    if (!out) return;
    burst(out, ctx.currentTime, { dur: 0.05, peak: 0.3, type: 'bandpass', freq: 1100, q: 2 });
  }

  function ui(kind = 'click') {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'objective') {
      tone(sfx, t, { f0: 440, f1: 440, dur: 0.25, peak: 0.12, type: 'triangle' });
      tone(sfx, t + 0.18, { f0: 660, f1: 660, dur: 0.4, peak: 0.12, type: 'triangle' });
    } else if (kind === 'checkpoint') {
      tone(sfx, t, { f0: 520, f1: 520, dur: 0.3, peak: 0.08, type: 'triangle' });
    } else if (kind === 'pickup') {
      burst(sfx, t, { dur: 0.06, peak: 0.25, type: 'bandpass', freq: 1800, q: 2 });
      tone(sfx, t + 0.04, { f0: 900, f1: 1200, dur: 0.12, peak: 0.06, type: 'triangle' });
    } else if (kind === 'hit') {
      burst(sfx, t, { dur: 0.03, peak: 0.18, type: 'bandpass', freq: 2800, q: 3 });
    } else if (kind === 'kill') {
      tone(sfx, t, { f0: 1600, f1: 1300, dur: 0.09, peak: 0.07, type: 'triangle' });
    } else if (kind === 'hurt') {
      burst(sfx, t, { dur: 0.15, peak: 0.45, type: 'lowpass', freq: 500, q: 1 });
      tone(sfx, t, { f0: 90, f1: 60, dur: 0.2, peak: 0.4 });
    } else if (kind === 'beep') {
      tone(sfx, t, { f0: 1200, f1: 1200, dur: 0.08, peak: 0.1, type: 'square' });
    }
  }

  return {
    init,
    get ready() { return !!ctx; },
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    setListener(x, y, z, yaw) { listener.x = x; listener.y = y; listener.z = z; listener.yaw = yaw; },
    setRain(a, indoor = false) {
      if (!rainGain) return;
      rainGain.gain.value = 0.16 * a;
      rainLP.frequency.value = indoor ? 900 : 5200;
    },
    suspend() { ctx?.suspend(); },
    resume() { ctx?.resume(); },
    gunshot, garandPing, dryFire, reload, switchWeapon, whizz, impact, explosion, thunder, distant,
    footstep, pin, grenadeBounce, ui,
  };
}
