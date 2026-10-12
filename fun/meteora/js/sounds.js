/* Meteora — the sound bank, synthesised.

   Every effect is a few lines of arithmetic over oscillators and noise,
   rendered once at load into plain sample arrays: nothing to download, and
   because nothing here touches a browser API, the checks render every
   sound in Node and listen for clipping, clicks and silence. audio.js
   turns the arrays into buffers and plays them where things happen.

   The shapes, briefly. Our cannon is a fast downward zap over a low thump
   with a crack of discharge; theirs is rougher, a clipped buzz. A bolt on
   rock is a crack, a thud and a rattle of grit; on a shield, a resonant
   fizz sweeping down with an inharmonic ring; on a hull, a struck plate's
   modes. Breaks and blasts are a broadband crack, a body whose lowpass
   closes over a second or so, a sub-bass drop and a tail of debris; a ship
   adds a second blast a beat later and pieces ringing as they fly.

   The other half is the arithmetic of the mix, kept here so the checks pin
   it too: the engine's pitch from speed, doppler from closing speed, the
   dulling of distance and the lock tone's quickening. */

import { AUDIO } from './config.js';
import { makeRng } from './rng.js';

export const RATE = 48000;
const TAU = Math.PI * 2;

/* ---------- the mix ---------- */

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// The engine's fundamental, Hz: a glide that rises fast through the speeds
// the ship cruises at and keeps creeping up beyond them — the physics has
// no top speed, so neither does the pitch. Smooth, never stepped.
export const enginePitch = speed => {
  const s = Math.max(0, speed);
  return 31 + 33 * (1 - Math.exp(-s / 190)) + 0.012 * s;
};

/* Pitch ratio for a source at `r` (source − listener) moving at `v`
   (source − listener velocity): c / (c − closing speed). Approaching
   raises it, receding lowers it, passing sideways leaves it alone. */
export function doppler(rx, ry, rz, vx, vy, vz, c = AUDIO.soundSpeed) {
  const d = Math.hypot(rx, ry, rz);
  if (d < 1e-6) return 1;
  const closing = clamp(-(rx * vx + ry * vy + rz * vz) / d, -0.6 * c, 0.6 * c);
  return clamp(c / (c - closing), 0.5, 2);
}

// Distance dulls a sound the way air would: a lowpass cutoff (Hz) that
// closes from full range close by to a rumble a couple of kilometres out.
export const muffle = d => 400 + 17600 * Math.exp(-Math.max(0, d) / 450);

// Seconds between lock beeps: unhurried as the lock starts, frantic as it
// completes.
export const lockBeepInterval = progress => 0.22 - 0.15 * clamp(progress, 0, 1);

/* ---------- synthesis ---------- */

// A state-variable filter (the topology-preserving form), stable under a
// moving cutoff, which most of these sounds sweep. A moving cutoff is
// re-read every 16 samples, a third of a millisecond, which no ear can
// tell from every sample. mode: 0 lowpass, 1 bandpass, 2 highpass.
function svf() {
  let ic1 = 0, ic2 = 0, k = 1, a1 = 0, a2 = 0, a3 = 0, last = -1, tick = 0;
  return (x, cutoff, q, mode) => {
    if (last < 0 || (cutoff !== last && (++tick & 15) === 0)) {
      const g = Math.tan(Math.PI * Math.min(cutoff, RATE * 0.45) / RATE);
      k = 1 / q; a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; last = cutoff;
    }
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    return mode === 0 ? v2 : mode === 1 ? v1 : x - k * v1 - v2;
  };
}

const rise = (t, seconds) => Math.min(1, t / seconds);

// exp(−t / tau) one sample at a time, as a running product: a long blast
// needs a dozen of these per sample, and a multiply is far cheaper.
function decay(tau) {
  const k = Math.exp(-1 / (RATE * tau));
  let v = 1 / k;
  return () => (v *= k);
}

// Fills a buffer sample by sample. A generator, pausing every few thousand
// samples, so a page can render the bank in slices between frames.
function* render(seconds, sample) {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = sample(i / RATE);
    if ((i & 4095) === 4095) yield;
  }
  return out;
}

// Scaled so the loudest sample sits at `peak`.
function normalize(out, peak) {
  let max = 0;
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]));
  const k = max > 0 ? peak / max : 0;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

// Normalised, with a millisecond's fade in and ten out, so no sound starts
// or stops on a click.
function finish(out, peak = 0.9) {
  normalize(out, peak);
  const fadeIn = RATE * 0.001, fadeOut = RATE * 0.01;
  for (let i = 0; i < out.length; i++) out[i] *= Math.min(1, i / fadeIn, (out.length - 1 - i) / fadeOut);
  return out;
}

/* Scattered short events — grit, debris, crackle: up to `count` start
   times whose density falls off as exp(−t / spread) after `from`, none
   later than `until`. */
function scatter(rng, count, from, spread, until) {
  const times = [];
  for (let k = 0; k < count; k++) {
    const t = from - spread * Math.log(1 - rng.next() * 0.98);
    if (t < until) times.push(t);
  }
  return times.sort((a, b) => a - b);
}

// A sum of decaying sines: a struck metal plate, a ringing shard.
function modes(t, f0, ratios, decays, amps) {
  let s = 0;
  for (let k = 0; k < ratios.length; k++) s += amps[k] * Math.sin(TAU * f0 * ratios[k] * t) * Math.exp(-t / decays[k]);
  return s;
}
const PLATE = [1, 1.58, 2.31, 2.97, 4.12, 5.53];

// Clicks at the given times, each a few milliseconds of noise decaying.
function clicks(rng, times, decay, amp) {
  const fall = Math.exp(-1 / (RATE * decay));
  let next = 0, level = 0;
  return t => {
    while (next < times.length && times[next] <= t) level = amp(times[next++]) * (0.5 + rng.next());
    if (level < 1e-5) return 0;
    level *= fall;
    return level * (rng.next() * 2 - 1);
  };
}

function cannon(rng) {
  const crackF = svf(), hissF = svf();
  const pitch = rng.range(0.96, 1.04);
  let zap = 0, thump = 0;
  return render(0.24, t => {
    zap += TAU * (170 + 1500 * Math.exp(-t / 0.016)) * pitch / RATE;
    thump += TAU * (48 + 70 * Math.exp(-t / 0.03)) / RATE;
    const n = rng.next() * 2 - 1;
    const tone = (Math.sin(zap) + 0.25 * Math.sin(2 * zap + 0.5)) * Math.exp(-t / 0.045) * rise(t, 0.0015);
    const body = Math.sin(thump) * Math.exp(-t / 0.055) * rise(t, 0.002);
    const crack = crackF(n, 2600 - 1400 * Math.min(1, t / 0.03), 1.4, 1) * Math.exp(-t / 0.01);
    const hiss = hissF(n, 3500, 0.7, 2) * Math.exp(-t / 0.06);
    return Math.tanh((tone * 0.45 + body * 0.8 + crack * 1.4 + hiss * 0.18) * 1.4);
  });
}

function enemyCannon(rng) {
  const lp = svf(), crackF = svf();
  const pitch = rng.range(0.95, 1.05);
  let phase = 0, thump = 0;
  return render(0.22, t => {
    phase += (120 + 800 * Math.exp(-t / 0.025)) * pitch / RATE;
    thump += TAU * (40 + 45 * Math.exp(-t / 0.03)) / RATE;
    const saw = 2 * (phase % 1) - 1;
    const buzz = Math.tanh(saw * 3) * (0.6 + 0.4 * Math.sin(TAU * 73 * t)) * Math.exp(-t / 0.05) * rise(t, 0.002);
    const crack = crackF(rng.next() * 2 - 1, 1700, 1.2, 1) * Math.exp(-t / 0.012);
    const body = Math.sin(thump) * Math.exp(-t / 0.05) * rise(t, 0.002);
    return Math.tanh((lp(buzz, 2400, 0.9, 0) * 0.6 + body * 0.6 + crack * 1.2) * 1.3);
  });
}

function missileLaunch(rng) {
  const popF = svf(), roarF = svf(), rumbleF = svf(), crackleF = svf();
  const crackle = clicks(rng, scatter(rng, 260, 0.05, 0.5, 1.5), 0.002, () => 1);
  let thump = 0, brown = 0;
  return render(1.6, t => {
    const n = rng.next() * 2 - 1;
    brown = (brown + 0.02 * n) / 1.02;
    thump += TAU * (40 + 60 * Math.exp(-t / 0.04)) / RATE;
    const pop = Math.sin(thump) * Math.exp(-t / 0.09) + popF(n, 1200, 0.7, 0) * Math.exp(-t / 0.02) * 1.5;
    // The motor: a roar whose hiss falls in pitch as it pulls away.
    const motor = rise(t, 0.04) * (t < 0.35 ? 1 : Math.exp(-(t - 0.35) / 0.5));
    const roar = roarF(n, 500 + 2800 * Math.exp(-t / 1.1), 0.9, 1) * motor;
    const rumble = rumbleF(brown * 6, 260, 0.8, 0) * motor;
    return Math.tanh((pop * 0.9 + roar * 1.2 + rumble * 0.8 + crackleF(crackle(t), 2500, 0.8, 2) * motor * 0.5) * 1.2);
  });
}

function hitRock(rng) {
  const crackF = svf(), bodyF = svf(), gritF = svf();
  const grit = clicks(rng, scatter(rng, 12, 0.015, 0.08, 0.32), 0.0012, t => Math.exp(-t / 0.12));
  const pitch = rng.range(0.9, 1.1);
  let thud = 0;
  return render(0.45, t => {
    const n = rng.next() * 2 - 1;
    thud += TAU * (55 + 70 * Math.exp(-t / 0.02)) * pitch / RATE;
    const crack = crackF(n, 1500, 0.8, 2) * Math.exp(-t / 0.005);
    const body = bodyF(n, 650 * pitch, 1.1, 1) * Math.exp(-t / 0.045);
    const low = Math.sin(thud) * Math.exp(-t / 0.07) * rise(t, 0.002);
    return Math.tanh((crack * 1.2 + body * 1.6 + low * 0.9 + gritF(grit(t), 3200, 1.5, 1) * 1.4) * 1.2);
  });
}

function hitShield(rng) {
  const fizzF = svf();
  const pitch = rng.range(0.94, 1.06);
  const zaps = clicks(rng, scatter(rng, 14, 0.005, 0.05, 0.2), 0.0008, t => Math.exp(-t / 0.08));
  return render(0.5, t => {
    const n = rng.next() * 2 - 1;
    const fizz = fizzF(n + zaps(t) * 2, 1100 + 5200 * Math.exp(-t / 0.05), 5, 1) * Math.exp(-t / 0.09);
    const wobble = 1 + 0.004 * Math.sin(TAU * 38 * t);
    const ring = modes(t * wobble, 1730 * pitch, [1, 1.51, 2.27], [0.12, 0.09, 0.06], [0.6, 0.45, 0.3]) * rise(t, 0.001);
    const whump = Math.sin(TAU * 140 * t) * Math.exp(-t / 0.04) * rise(t, 0.002);
    return Math.tanh((fizz * 1.6 + ring * 0.7 + whump * 0.5) * 1.2);
  });
}

function hitHull(rng) {
  const crunchF = svf();
  const f0 = rng.range(300, 420);
  let thump = 0;
  return render(0.5, t => {
    thump += TAU * (60 + 50 * Math.exp(-t / 0.02)) / RATE;
    const plate = modes(t, f0, PLATE, [0.18, 0.14, 0.1, 0.08, 0.06, 0.045], [1, 0.7, 0.55, 0.4, 0.3, 0.2]) * rise(t, 0.0008);
    const crunch = crunchF(rng.next() * 2 - 1, 1400, 0.9, 1) * Math.exp(-t / 0.025);
    const body = Math.sin(thump) * Math.exp(-t / 0.05) * rise(t, 0.002);
    return Math.tanh((plate * 0.5 + crunch * 1.6 + body * 0.8) * 1.3);
  });
}

function rockBreak(rng) {
  const crackF = svf(), crunchF = svf(), rattleF = svf(), dustF = svf();
  const rattle = clicks(rng, scatter(rng, 48, 0.03, 0.4, 1.5), 0.0025, t => Math.exp(-t / 0.5));
  let boom = 0;
  return render(1.8, t => {
    const n = rng.next() * 2 - 1;
    boom += TAU * (36 + 40 * Math.exp(-t / 0.08)) / RATE;
    const crack = crackF(n, 700, 0.7, 2) * Math.exp(-t / 0.012);
    const crunch = crunchF(n, 300 + 3200 * Math.exp(-t / 0.12), 0.8, 0) * Math.exp(-t / 0.2);
    const low = Math.sin(boom) * Math.exp(-t / 0.3) * rise(t, 0.004);
    const dust = dustF(n, 1800, 0.5, 1) * Math.exp(-t / 0.6) * rise(t, 0.05);
    return Math.tanh((crack * 1.5 + crunch * 1.5 + low * 1.1 + rattleF(rattle(t), 2600, 1.2, 1) * 1.3 + dust * 0.15) * 1.1);
  });
}

/* A blast: crack, a body closing from bright to dull, a sub-bass drop, a
   rumble and a tail of crackle. `size` stretches it all; `second` adds a
   later, smaller blast; `pieces` adds debris ringing as it flies. */
function blastOf(rng, { seconds, size, second = 0, pieces = 0 }) {
  const crackF = svf(), bodyF = svf(), rumbleF = svf(), crackleF = svf(), crack2F = svf(), body2F = svf();
  const crackle = clicks(rng, scatter(rng, 90, 0.1, 0.6 * size, seconds - 0.2), 0.002, t => Math.exp(-t / (0.8 * size)));
  const rings = Array.from({ length: pieces }, () => {
    const at = rng.range(0.25, 2.2 * size), decay = rng.range(0.05, 0.15);
    return { at, end: at + 6 * decay, f: rng.range(500, 2500), decay, amp: rng.range(0.2, 0.5) };
  });
  const crackEnv = decay(0.006), sweep = decay(0.25 * size), bodyEnv = decay(0.45 * size);
  const drop = decay(0.12 * size), lowEnv = decay(0.6 * size), rumbleEnv = decay(size), deeper = size ** 0.25;
  const crack2 = decay(0.008), sweep2 = decay(0.15), body2 = decay(0.3);
  let boom = 0, brown = 0;
  return render(seconds, t => {
    const n = rng.next() * 2 - 1;
    brown = (brown + 0.02 * n) / 1.02;
    boom += TAU * (26 + 38 * drop()) / deeper / RATE;
    const crack = crackF(n, 200, 0.7, 2) * crackEnv() * 1.3;
    const body = bodyF(n, 160 + 5000 * sweep(), 0.7, 0) * bodyEnv();
    const low = Math.sin(boom) * lowEnv() * rise(t, 0.006) * 1.2;
    const rumble = rumbleF(brown * 6, 220, 0.7, 0) * rumbleEnv() * rise(t, 0.05);
    let s = crack + body * 1.6 + low + rumble * 0.9 + crackleF(crackle(t), 2200, 0.8, 1) * 0.6;
    if (second > 0 && t >= second) s += (crack2F(n, 300, 0.7, 2) * crack2() + body2F(n, 200 + 3000 * sweep2(), 0.7, 0) * body2()) * 0.7;
    for (const r of rings) if (t >= r.at && t < r.end) s += r.amp * Math.sin(TAU * r.f * (t - r.at)) * Math.exp(-(t - r.at) / r.decay);
    return Math.tanh(s * 1.1);
  });
}

function afterburnerIgnite(rng) {
  const whoompF = svf(), crackleF = svf();
  const crackle = clicks(rng, scatter(rng, 50, 0.02, 0.15, 0.6), 0.0015, t => Math.exp(-t / 0.2));
  let sub = 0;
  return render(0.9, t => {
    const n = rng.next() * 2 - 1;
    sub += TAU * (38 + 30 * Math.exp(-t / 0.1)) / RATE;
    // The lowpass flings open as it lights, then settles into the roar.
    const open = t < 0.08 ? t / 0.08 : Math.exp(-(t - 0.08) / 0.25);
    const whoomp = whoompF(n, 150 + 2000 * open, 0.9, 0) * rise(t, 0.025) * Math.exp(-t / 0.35);
    const low = Math.sin(sub) * Math.exp(-t / 0.25) * rise(t, 0.01);
    return Math.tanh((whoomp * 2 + low * 0.9 + crackleF(crackle(t), 3000, 0.8, 2) * 0.5) * 1.1);
  });
}

// Cockpit tones: clean pips with a little second harmonic for presence.
const pip = (t, start, f, length) => {
  const u = t - start;
  if (u < 0 || u > length) return 0;
  return (Math.sin(TAU * f * u) + 0.15 * Math.sin(TAU * 2 * f * u)) * rise(u, 0.003) * Math.min(1, (length - u) / 0.006);
};
const targetChange = () => render(0.14, t => pip(t, 0, 1320, 0.05) * 0.8 + pip(t, 0.06, 1760, 0.065));
const lockOn = () => render(0.11, t => pip(t, 0, 1975, 0.035) + pip(t, 0.065, 1975, 0.035));

/* Name → variants. Short, much-repeated sounds get several takes so a
   held trigger does not sound like a loop; long ones get one or two. */
const BANK = {
  cannon: [3, cannon],
  enemyCannon: [3, enemyCannon],
  missileLaunch: [1, missileLaunch],
  hitRock: [3, hitRock],
  hitShield: [3, hitShield],
  hitHull: [3, hitHull],
  rockBreak: [2, rockBreak],
  blast: [2, rng => blastOf(rng, { seconds: 2.6, size: 1 })],
  shipExplosion: [2, rng => blastOf(rng, { seconds: 3.6, size: 1.35, second: rng.range(0.2, 0.35), pieces: 6 })],
  playerExplosion: [1, rng => blastOf(rng, { seconds: 5, size: 1.9, second: 0.3, pieces: 9 })],
  afterburnerIgnite: [1, afterburnerIgnite],
  targetChange: [1, targetChange],
  lockOn: [1, lockOn],
};
export const SOUND_NAMES = Object.keys(BANK);

const seedOf = (name, k) => 101 + k * 7919 + name.length;

export function synthesize(name, seed = 1) {
  const job = BANK[name][1](makeRng(seed));
  let step;
  do step = job.next(); while (!step.done);
  return finish(step.value);
}

export function soundBank() {
  const bank = {};
  for (const [name, [variants]] of Object.entries(BANK)) {
    bank[name] = Array.from({ length: variants }, (_, k) => synthesize(name, seedOf(name, k)));
  }
  return bank;
}

/* The same bank, one step at a time: each `next()` does a few thousand
   samples' work, and `done(name, samples)` receives every take as it is
   finished, the sounds the fight needs first coming first. */
export function* synthesizeBank(done) {
  for (const [name, [variants, make]] of Object.entries(BANK)) {
    for (let k = 0; k < variants; k++) {
      const job = make(makeRng(seedOf(name, k)));
      let step;
      while (!(step = job.next()).done) yield;
      done(name, finish(step.value));
    }
  }
}

/* Loops for the continuous voices, two seconds each, seamless: white
   noise, brown noise (white through a leaky integrator, its drift taken
   out so the ends meet), and crackle (sparse clicks laid round the loop's
   end and back to its start). */
export function loops() {
  const rng = makeRng(77), n = RATE * 2;
  const noise = new Float32Array(n), brown = new Float32Array(n), crackle = new Float32Array(n);
  let b = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    noise[i] = w * 0.7;
    b = (b + 0.02 * w) / 1.02;
    brown[i] = b;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) brown[i] -= (brown[n - 1] - brown[0]) * i / (n - 1);
  for (let i = 0; i < n; i++) mean += brown[i] / n;
  for (let i = 0; i < n; i++) brown[i] -= mean;
  for (let k = 0; k < 140; k++) {
    const at = Math.floor(rng.next() * n), amp = rng.range(0.2, 1) * (rng.next() < 0.5 ? -1 : 1);
    const decay = RATE * rng.range(0.0008, 0.003);
    for (let j = 0; j < decay * 6; j++) crackle[(at + j) % n] += amp * Math.exp(-j / decay) * (rng.next() * 2 - 1);
  }
  return { noise, brown: normalize(brown, 0.8), crackle: normalize(crackle, 0.8) };
}
