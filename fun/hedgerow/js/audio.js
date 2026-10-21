/* Hedgerow — procedural sound (Web Audio).

   Nothing is downloaded: the rain bed, wind, thunder, gunfire, bullets
   cracking past, impacts, footsteps, reloads and explosions are built from
   filtered noise and short oscillator sweeps. World sounds are panned and
   attenuated by distance from the listener and lose their highs with
   distance; gunfire carries a short slap-back echo from the houses and the
   tree line.

   Foley: footsteps by surface (hobnails clicking on stone, mud sucking at
   the boot, grass swishing, leaf litter crackling, planks knocking hollow,
   water splashing) with heel and toe and a little difference every step;
   the kit (canteen, scabbard, pouches, the rifle on its sling) when running,
   jumping, landing, kneeling; the rifle shouldered; reloads in their parts;
   empty cases ringing on stone; bodies and rifles falling; ricochets off
   stone and steel; and the rain ticking on the helmet. */

import { rng } from './util.js';

export function createAudio() {
  let ctx = null, master = null, sfx = null, amb = null, verb = null;
  let noiseBuf = null, brownBuf = null;
  let volume = 0.8;
  const R = rng(77);
  const listener = { x: 0, y: 0, z: 0, yaw: 0 };
  let rainGain = null, windGain = null, rainLP = null, helmetGain = null;

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
    // rain on the helmet: a loop of drops ticking on steel, close, all round the head
    const sec = 3, n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let k = 0; k < 36; k++) {
        const len = 500 + Math.floor(R() * 900), at = Math.floor(R() * (n - len));
        const w = (3000 + R() * 2800) / ctx.sampleRate * 2 * Math.PI, amp = 0.2 + R() * 0.8;
        for (let i = 0; i < len; i++) d[at + i] += (Math.sin(i * w) * Math.exp(-i / (len * 0.16)) * 0.5 + (R() * 2 - 1) * Math.exp(-i / 30) * 0.35) * amp;
      }
    }
    const hs = ctx.createBufferSource(); hs.buffer = buf; hs.loop = true;
    helmetGain = ctx.createGain(); helmetGain.gain.value = 0.045;
    hs.connect(helmetGain).connect(amb);
    hs.start();
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

  /* A reload, the player's own or someone else's at a position, in its
     parts (at the moments of the clip in reload.js). Garand: the operating
     rod back, the clip shoved in, the thumb out, the bolt slamming home.
     Thompson: the magazine catch, the empty one out (and onto the ground),
     the full one slapped in, the bolt racked. Others: four clicks. */
  function reload(kind, at = null) {
    if (!ctx) return;
    const out = at ? spatial(at.x, at.y + 1.2, at.z, { ref: 2, max: 30 }) : sfx;
    if (!out) return;
    const t = ctx.currentTime;
    const click = (tt, f, peak, d = 0.04, q = 3) => burst(out, tt, { dur: d, peak, type: 'bandpass', freq: f * (0.95 + R() * 0.1), q });
    const slide = (tt, f0, f1, peak, d = 0.09) => burst(out, tt, { dur: d, peak, type: 'bandpass', freq: f0, sweepTo: f1, q: 2 });
    if (kind === 'garand') {
      slide(t + 0.17, 1800, 2600, 0.12); click(t + 0.24, 2300, 0.3);
      slide(t + 0.72, 1200, 1800, 0.15, 0.12); click(t + 0.83, 2800, 0.26);
      click(t + 1.45, 3400, 0.12, 0.03);
      click(t + 1.85, 1900, 0.42, 0.05, 2);
      tone(out, t + 1.85, { f0: 260, f1: 150, dur: 0.08, peak: 0.18, type: 'triangle' });
    } else if (kind === 'thompson') {
      click(t + 0.25, 3000, 0.22, 0.03);
      slide(t + 0.3, 1500, 900, 0.12, 0.1);
      burst(out, t + 0.78, { dur: 0.06, peak: 0.1, type: 'bandpass', freq: 1300, q: 1.5 });
      slide(t + 0.8, 900, 1600, 0.14, 0.12); click(t + 0.95, 2400, 0.32, 0.04, 2);
      slide(t + 1.55, 2000, 1400, 0.15, 0.08); click(t + 1.62, 2600, 0.3);
      click(t + 2.05, 2200, 0.38, 0.05, 2);
    } else {
      const clicks = [0.25, 0.85, 1.6, 2.05];
      clicks.forEach((dt, i) => click(t + dt, 2200 + i * 500, 0.25 + (i === clicks.length - 1 ? 0.15 : 0)));
    }
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
      if (R() < 0.4) ricochet(out, t);
    } else if (surface === 'water') {
      burst(out, t, { dur: 0.18, peak: 0.35, type: 'bandpass', freq: 1200, sweepTo: 600, q: 1 });
    } else if (surface === 'wood') {
      burst(out, t, { dur: 0.08, peak: 0.4, type: 'bandpass', freq: 900, q: 1.5 });
    } else if (surface === 'flesh') {
      burst(out, t, { dur: 0.08, peak: 0.45, type: 'lowpass', freq: 700, q: 1 });
    } else if (surface === 'stone' || surface === 'cobble' || surface === 'concrete') {
      burst(out, t, { dur: 0.06, peak: 0.4, type: 'bandpass', freq: 2400, q: 1.2 });
      if (R() < 0.22) ricochet(out, t);
    } else {
      burst(out, t, { dur: 0.1, peak: 0.35, type: 'lowpass', freq: 600, q: 0.7 });
    }
  }

  /* A bullet glancing off and whining away. */
  function ricochet(out, t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const f0 = 2600 + R() * 1800;
    o.frequency.setValueAtTime(f0, t + 0.01);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.4 + R() * 0.15), t + 0.38);
    const g = ctx.createGain(); env(g, t + 0.01, 0.01, 0.045 + R() * 0.03, 0.36);
    o.connect(g).connect(out); o.start(t + 0.01); o.stop(t + 0.45);
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

  /* ---------- foley ---------- */

  // which kind of step a surface makes
  const STEP = {
    cobble: 'hard', stone: 'hard', concrete: 'hard', tile: 'hard', metal: 'metal', iron: 'metal',
    wood: 'wood', planks: 'wood', mud: 'mud', dirt: 'mud', grass: 'grass', forest: 'leaves', foliage: 'leaves',
    sandbag: 'soft', fabric: 'soft', water: 'water',
  };

  /* A step: heel, then toe, a little different every time. `run` adds the
     kit, `wet` (0..1) a thin splash on hard ground and grass in the rain. */
  function footstep(x, y, z, surface, loud = 1, player = false, { run = false, wet = 0 } = {}) {
    if (!ctx) return;
    const out = player ? sfx : spatial(x, y, z, { ref: 2, max: 40 });
    if (!out) return;
    const t = ctx.currentTime;
    const g = (player ? 0.22 : 0.3) * loud;
    const v = 0.9 + R() * 0.2;
    const toe = t + 0.05 + R() * 0.03;
    switch (STEP[surface] || 'hard') {
      case 'hard':
        burst(out, t, { dur: 0.05, peak: g, type: 'bandpass', freq: 1100 * v, q: 1.4 });
        burst(out, t, { dur: 0.02, peak: g * 0.45, type: 'bandpass', freq: 4200 * v, q: 3 });          // hobnails
        burst(out, toe, { dur: 0.04, peak: g * 0.6, type: 'bandpass', freq: 1500 * v, q: 1.6 });
        burst(out, toe + 0.01, { dur: 0.06, peak: g * 0.18, type: 'highpass', freq: 3500 });            // grit under the sole
        if (wet > 0) burst(out, t + 0.005, { dur: 0.09, peak: g * 0.5 * wet, type: 'bandpass', freq: 2600 * v, sweepTo: 1200, q: 1.1 });
        break;
      case 'mud':
        burst(out, t, { dur: 0.11, peak: g, type: 'lowpass', freq: 520 * v, q: 1.3 });
        burst(out, t + 0.02, { dur: 0.16, peak: g * 0.55, type: 'bandpass', freq: 900 * v, sweepTo: 350, q: 2.5 });      // squelch
        burst(out, t + 0.16 + R() * 0.05, { dur: 0.06, peak: g * 0.35, type: 'bandpass', freq: 1600 * v, sweepTo: 2600, q: 4 });   // the boot pulling free
        break;
      case 'grass':
        burst(out, t, { dur: 0.09, peak: g * 0.75, type: 'lowpass', freq: 600 * v, q: 1 });
        burst(out, t + 0.01, { dur: 0.16, peak: g * 0.3, type: 'highpass', freq: 3800 * v });            // blades swishing
        if (wet > 0) burst(out, t + 0.02, { dur: 0.12, peak: g * 0.25 * wet, type: 'bandpass', freq: 2000, q: 1 });
        break;
      case 'leaves':
        burst(out, t, { dur: 0.09, peak: g * 0.7, type: 'lowpass', freq: 650 * v, q: 1 });
        for (let i = 0; i < 4; i++) burst(out, t + R() * 0.12, { dur: 0.012, peak: g * (0.15 + R() * 0.2), type: 'bandpass', freq: 2500 + R() * 3500, q: 2 });
        if (R() < 0.15) burst(out, t + 0.04, { dur: 0.015, peak: g * 0.6, type: 'highpass', freq: 1800 });   // a twig snaps
        break;
      case 'wood':
        tone(out, t, { f0: 190 * v, f1: 120 * v, dur: 0.12, peak: g * 0.8, type: 'triangle' });
        burst(out, t, { dur: 0.06, peak: g * 0.8, type: 'bandpass', freq: 700 * v, q: 2 });
        burst(out, toe, { dur: 0.04, peak: g * 0.45, type: 'bandpass', freq: 950 * v, q: 2 });
        if (R() < 0.2) tone(out, t + 0.08, { f0: 420 * v, f1: 380 * v, dur: 0.25, peak: g * 0.1, type: 'sawtooth' });   // a board creaks
        break;
      case 'metal':
        tone(out, t, { f0: 600 * v, f1: 540 * v, dur: 0.2, peak: g * 0.35, type: 'triangle' });
        burst(out, t, { dur: 0.04, peak: g * 0.8, type: 'bandpass', freq: 2200 * v, q: 2 });
        break;
      case 'soft':
        burst(out, t, { dur: 0.1, peak: g * 0.7, type: 'lowpass', freq: 450 * v, q: 0.8 });
        burst(out, t + 0.02, { dur: 0.08, peak: g * 0.2, type: 'bandpass', freq: 1500, q: 1 });
        break;
      case 'water':
        burst(out, t, { dur: 0.22, peak: g * 1.4, type: 'bandpass', freq: 900 * v, sweepTo: 400, q: 0.9 });
        burst(out, t + 0.05, { dur: 0.3, peak: g * 0.6, type: 'bandpass', freq: 1800 * v, sweepTo: 700, q: 1.2 });       // slosh
        for (let i = 0; i < 3; i++) burst(out, t + 0.1 + R() * 0.25, { dur: 0.03, peak: g * 0.2, type: 'bandpass', freq: 2500 + R() * 2000, q: 4 });
        break;
    }
    if (run) kit(out, t + 0.02, g * 0.7);
  }

  /* The kit on a moving soldier: canteen, scabbard, pouches, the rifle on its
     sling, webbing and wool. */
  function kit(out, t, peak) {
    burst(out, t, { dur: 0.05, peak: peak * 0.35, type: 'bandpass', freq: 2900 + R() * 900, q: 5 });
    if (R() < 0.5) tone(out, t + 0.01, { f0: 1700 + R() * 600, f1: 1500, dur: 0.07, peak: peak * 0.06, type: 'triangle' });
    burst(out, t, { dur: 0.12, peak: peak * 0.18, type: 'bandpass', freq: 1200, q: 0.8 });
  }

  /* The player's own moves: kneeling, getting up, shouldering the rifle,
     a jump, a landing (on `surface`). */
  function gear(kind, surface = 'mud') {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'crouch' || kind === 'stand') {
      const down = kind === 'crouch';
      burst(sfx, t, { dur: 0.22, peak: 0.08, type: 'bandpass', freq: down ? 900 : 1200, sweepTo: down ? 500 : 1800, q: 0.7 });
      kit(sfx, t + 0.05, 0.18);
    } else if (kind === 'aim') {
      burst(sfx, t, { dur: 0.12, peak: 0.06, type: 'bandpass', freq: 1500, sweepTo: 900, q: 0.8 });
      burst(sfx, t + 0.06, { dur: 0.03, peak: 0.07, type: 'bandpass', freq: 3200, q: 4 });          // sling swivel
    } else if (kind === 'jump') {
      burst(sfx, t, { dur: 0.15, peak: 0.07, type: 'bandpass', freq: 1100, q: 0.7 });
      kit(sfx, t + 0.03, 0.2);
    } else if (kind === 'land') {
      footstep(0, 0, 0, surface, 1.5, true);
      kit(sfx, t + 0.01, 0.3);
      kit(sfx, t + 0.06, 0.2);
    }
  }

  /* An empty case landing where it fell, `delay` after the shot: brass rings
     on stone and steel, ticks on planks, is lost in mud, grass and leaves. */
  function casing(x, y, z, surface, delay = 0.45) {
    if (!ctx) return;
    const kind = STEP[surface] || 'hard';
    if (kind !== 'hard' && kind !== 'metal' && kind !== 'wood') return;
    const out = spatial(x, y, z, { ref: 1.5, max: 20, lowpassFar: false });
    if (!out) return;
    const t = ctx.currentTime + delay;
    const f = (kind === 'wood' ? 2600 : 3800) + R() * 1500;
    const n = kind === 'wood' ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.09 - i * 0.02) + R() * 0.01;
      tone(out, tt, { f0: f * (1 + R() * 0.05), f1: f * 0.98, dur: (kind === 'wood' ? 0.05 : 0.12) - i * 0.02, peak: 0.07 / (i + 1), type: 'sine' });
      if (kind !== 'wood') tone(out, tt, { f0: f * 2.7, f1: f * 2.65, dur: 0.06, peak: 0.025 / (i + 1), type: 'sine' });
    }
  }

  /* A body hitting the ground `delay` from now, the kit with it, the rifle
     clattering down a moment later. */
  function bodyFall(x, y, z, surface = 'mud', delay = 0.5, player = false) {
    if (!ctx) return;
    const out = player ? sfx : spatial(x, y, z, { ref: 3, max: 50 });
    if (!out) return;
    const t = ctx.currentTime + delay;
    const kind = STEP[surface] || 'mud';
    burst(out, t, { dur: 0.22, peak: 0.55, type: 'lowpass', freq: kind === 'hard' ? 500 : 320, q: 0.9, brown: true });
    tone(out, t, { f0: 85, f1: 45, dur: 0.18, peak: 0.35 });
    if (kind === 'mud' || kind === 'water') burst(out, t + 0.03, { dur: 0.25, peak: 0.25, type: 'bandpass', freq: 800, sweepTo: 300, q: 1.5 });
    kit(out, t + 0.03, 0.5);
    kit(out, t + 0.12, 0.3);
    const rt = t + 0.18 + R() * 0.2;
    burst(out, rt, { dur: 0.07, peak: 0.25, type: 'bandpass', freq: kind === 'hard' ? 1800 : 1000, q: 1.5 });
    if (kind === 'hard') tone(out, rt, { f0: 900, f1: 850, dur: 0.15, peak: 0.05, type: 'triangle' });
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
      helmetGain.gain.value = indoor ? 0 : 0.045 * a;
    },
    suspend() { ctx?.suspend(); },
    resume() { ctx?.resume(); },
    gunshot, garandPing, dryFire, reload, switchWeapon, whizz, impact, explosion, thunder, distant,
    footstep, gear, casing, bodyFall, pin, grenadeBounce, ui,
  };
}
