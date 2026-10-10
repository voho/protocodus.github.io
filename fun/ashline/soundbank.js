// Ashline sound bank. Every effect is synthesized here from noise, oscillators and filters into mono PCM;
// no samples or recordings are used. The module never touches Web Audio, so node tests can render and
// inspect each recipe, and audio.js turns the arrays into buffers lazily, a few at a time, in idle slices.
// Each kind and variant has its own seed, so adding a recipe never changes the timbre of another.

export const RATE = 24000;
const TAU = Math.PI * 2;

function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0 || 1;
}
// Mulberry32. The state lives in a typed array: a closure variable holding int32 values beyond the small
// integer range would allocate a heap number on every call, and noise draws one per sample.
// Hot loops call nextRandom(rand.state) directly so the call stays monomorphic and inlinable.
function nextRandom(state) {
  const s = state[0] = state[0] + 0x6D2B79F5 | 0;
  let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
export function seededRandom(text) {
  const state = new Int32Array([hashText(text)]), rand = () => nextRandom(state);
  rand.state = state;
  return rand;
}

// Topology-preserving state-variable filter: stays stable while formants, wind and sweeps glide.
class Filter {
  constructor(frequency, q = .707) { this.ic1 = 0; this.ic2 = 0; this.band = 0; this.high = 0; this.set(frequency, q); }
  set(frequency, q = this.q) {
    this.q = q;
    const g = Math.tan(Math.PI * Math.min(Math.max(frequency, 10), RATE * .45) / RATE);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  step(x) {
    const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.band = v1 * this.k; this.high = x - this.k * v1 - v2;
    return v2;
  }
}

// Band-limited step correction keeps sawtooth and pulse voices from aliasing into hiss at 24 kHz.
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// Interpolated sine table: oscillators call it per sample, where Math.sin dominated the synthesis cost.
const TABLE = new Float32Array(4097);
for (let i = 0; i < TABLE.length; i++) TABLE[i] = Math.sin(TAU * i / 4096);
const sin1 = p => { const x = p * 4096, i = x | 0; return TABLE[i] + (TABLE[i + 1] - TABLE[i]) * (x - i); };
// Shapes are integer codes: one branching function stays inlinable where a table of shape functions made
// every per-sample call megamorphic and boxed its arguments.
const SINE = 0, SAW = 1, TRI = 2, SQUARE = 3, SHAPES = { sine: SINE, saw: SAW, tri: TRI, square: SQUARE };
function wave(shape, p, dt, duty) {
  if (shape === SINE) return sin1(p);
  if (shape === SAW) return 2 * p - 1 - blep(p, dt);
  if (shape === TRI) return 4 * Math.abs(p - .5) - 1;
  return (p < duty ? 1 : -1) + blep(p, dt) - blep((p + 1 - duty) % 1, dt);
}

// Envelopes and glides advance by a constant factor per sample instead of calling exp/pow. A voice stops
// early once its decay falls below -60 dB.
function stepper({ at, length, attack, decay, curve, gain, f = 0, to = f, time = 0 }, out) {
  const start = Math.round(at * RATE), attackSamples = Math.max(1, attack * RATE), glideSamples = Math.round(time * RATE);
  return {
    start, from: Math.max(0, start), stop: Math.min(out.length, length ? start + Math.round(length * RATE) : out.length),
    attackSamples, curve, gain, fall: Math.exp(-decay / RATE), floor: gain * 1e-3,
    glideSamples, glideStep: glideSamples > 0 && f !== to ? (to / f) ** (1 / glideSamples) : 1, release: RATE * .006,
  };
}

// Adds an enveloped oscillator. Frequency glides geometrically from f to `to`; fm is phase modulation.
function tone(out, { at = 0, f, to = f, time = 0, attack = .002, decay = 8, curve = 1, gain = .3, shape = 'sine', length = 0, vibrato = 0, rate = 5.5, fm = 0, ratio = 2, duty = .5, tremolo = 0, tremoloRate = 30 }) {
  const s = stepper({ at, length, attack, decay, curve, gain, f, to, time }, out), code = SHAPES[shape];
  let phase = 0, mod = 0, amp = gain, frequency = s.glideSamples > 0 ? f : to;
  for (let i = s.from; i < s.stop; i++) {
    const n = i - s.start;
    let level;
    if (n < s.attackSamples) level = gain * (s.curve === 1 ? n / s.attackSamples : (n / s.attackSamples) ** s.curve);
    else { level = amp; amp *= s.fall; if (amp < s.floor) break; }
    if (length) level *= Math.min(1, (s.stop - i) / s.release);
    if (tremolo) level *= 1 - tremolo * (.5 + .5 * sin1(tremoloRate * n / RATE % 1));
    if (n > 0 && n <= s.glideSamples) frequency = n === s.glideSamples ? to : frequency * s.glideStep;
    const current = vibrato ? frequency * (1 + vibrato * sin1(rate * n / RATE % 1)) : frequency;
    phase += current / RATE; if (phase >= 1) phase -= Math.floor(phase);
    let p = phase;
    if (fm) { mod += current * ratio / RATE; if (mod >= 1) mod -= Math.floor(mod); p += fm * sin1(mod) / TAU; p -= Math.floor(p); }
    out[i] += level * wave(code, p, current / RATE, duty);
  }
}

// Adds filtered noise. `color` integrates white noise toward a darker brown rumble; `grain` gates it into crackle.
function noise(out, rand, { at = 0, attack = .001, decay = 20, curve = 1, gain = .3, type = 'band', f = 1000, to = f, time = 0, q = .8, length = 0, color = 0, grain = 0, grainRate = 90 }) {
  const s = stepper({ at, length, attack, decay, curve, gain }, out), filter = type === 'none' ? null : new Filter(f, q);
  const sweep = time > 0 && f !== to ? Math.round(time * RATE) : 0, kind = type === 'low' ? 0 : type === 'high' ? 1 : 2;
  const state = rand.state;
  let brown = 0, gate = 1, gateTimer = 0, amp = gain;
  for (let i = s.from; i < s.stop; i++) {
    const n = i - s.start;
    let level;
    if (n < s.attackSamples) level = gain * (s.curve === 1 ? n / s.attackSamples : (n / s.attackSamples) ** s.curve);
    else { level = amp; amp *= s.fall; if (amp < s.floor) break; }
    if (length) level *= Math.min(1, (s.stop - i) / s.release);
    if (sweep && n % 32 === 0 && n <= sweep + 32) filter.set(f * (to / f) ** Math.min(1, n / sweep));
    let x = nextRandom(state) * 2 - 1;
    if (color) { brown = brown * .985 + x * .15; x = x * (1 - color) + brown * color * 2.2; }
    if (grain) {
      if (--gateTimer <= 0) { gate = nextRandom(state) < grain ? 1 : .08; gateTimer = RATE / grainRate * (.5 + nextRandom(state)); }
      level *= gate;
    }
    if (filter) { const low = filter.step(x); x = kind === 0 ? low : kind === 1 ? filter.high : filter.band; }
    out[i] += level * x;
  }
}

// Sawtooth through a lowpass that opens with the attack: a restrained brass/horn voice for stingers.
function brass(out, { at = 0, f, to = f, time = 0, attack = .05, length = .5, release = .2, gain = .2, bright = 2400, dark = 380, vibrato = .006 }) {
  const start = Math.round(at * RATE), stop = Math.min(out.length, start + Math.round((length + release) * RATE));
  const filter = new Filter(dark, .9), attackSamples = attack * RATE, holdSamples = length * RATE, fall = Math.exp(-3 / (release * RATE)), close = Math.exp(-1 / (release * RATE));
  const glideSamples = Math.round(time * RATE), glideStep = glideSamples > 0 && f !== to ? (to / f) ** (1 / glideSamples) : 1;
  let phase = 0, frequency = glideSamples > 0 ? f : to, tail = .75, open = 1;
  for (let i = Math.max(0, start); i < stop; i++) {
    const n = i - start;
    let level;
    if (n < attackSamples) level = (n / attackSamples) ** 1.5;
    else if (n < holdSamples) level = 1 - .25 * (n - attackSamples) / Math.max(RATE * .01, holdSamples - attackSamples);
    else { level = tail; tail *= fall; open *= close; }
    if (n % 16 === 0) filter.set(dark + (bright - dark) * Math.min(1, n / attackSamples) * open);
    if (n > 0 && n <= glideSamples) frequency = n === glideSamples ? to : frequency * glideStep;
    const current = vibrato ? frequency * (1 + vibrato * sin1(5.2 * n / RATE % 1) * Math.min(1, n / (RATE * .3))) : frequency;
    phase += current / RATE; if (phase >= 1) phase -= Math.floor(phase);
    out[i] += gain * level * filter.step(wave(SAW, phase, current / RATE, .5));
  }
}

// Adds a metallic or glass-like strike: inharmonic partials with independent decays.
function bell(out, { at = 0, f, gain = .2, decay = 4, partials = [1, 2.76, 5.4], fm = .6 }) {
  partials.forEach((ratio, index) => tone(out, { at, f: f * ratio, decay: decay * (1 + index * .8), gain: gain / (1 + index * 1.4), fm: index ? 0 : fm, ratio: 3.5 }));
}

function crush(out, bits, hold, from = 0, to = out.length) {
  const steps = 2 ** (bits - 1);
  let held = 0;
  for (let i = from; i < to; i++) {
    if ((i - from) % hold === 0) held = Math.round(out[i] * steps) / steps;
    out[i] = held;
  }
}

// Shared output stage: optional saturation, DC removal, click-free edges and peak normalization. Loops keep
// their wrap point intact: they drop the mean instead of running a DC filter and get no edge fades.
function finish(out, { level = .9, drive = 0, fadeIn = .0015, loop = false }) {
  let previousIn = 0, previousOut = 0, peak = 0, mean = 0;
  if (loop) { for (let i = 0; i < out.length; i++) mean += out[i]; mean /= out.length; }
  const pole = 1 - TAU * 18 / RATE, tail = Math.min(out.length, Math.round(RATE * .012)), head = Math.max(1, Math.round(RATE * fadeIn));
  for (let i = 0; i < out.length; i++) {
    let x = drive ? Math.tanh(out[i] * drive) : out[i];
    if (loop) x -= mean;
    else {
      const y = x - previousIn + pole * previousOut; previousIn = x; previousOut = y;
      x = y * Math.min(1, i / head, (out.length - i) / tail);
    }
    out[i] = x; peak = Math.max(peak, Math.abs(x));
  }
  if (peak > 0) { const scale = level / peak; for (let i = 0; i < out.length; i++) out[i] *= scale; }
  return out;
}

// Seamless loops: the rendered overhang is crossfaded (equal power) into the head of the loop.
function loopFold(out, overlap) {
  const length = out.length - overlap, folded = new Float32Array(length);
  for (let i = 0; i < length; i++) folded[i] = out[i];
  for (let i = 0; i < overlap; i++) {
    const x = i / overlap;
    folded[i] = out[i] * Math.sin(x * Math.PI / 2) + out[length + i] * Math.cos(x * Math.PI / 2);
  }
  return folded;
}
// Discrete events in loops wrap around the end instead of being cut.
function wrapped(length, render) {
  const scratch = new Float32Array(length * 2);
  render(scratch);
  const out = new Float32Array(length);
  for (let i = 0; i < scratch.length; i++) out[i % length] += scratch[i];
  return out;
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const jitter = (rand, amount) => 1 + (rand() * 2 - 1) * amount;

// Gunfire building blocks. Organics: powder crack, gas body, chest thump, gritty reflection, bolt clank.
function powderRound(out, rand, at, { crack = 2600, body = 900, low = 140, size = 1, clank = 0 }) {
  noise(out, rand, { at, type: 'high', f: crack * jitter(rand, .08), decay: 90 / size, gain: .9 });
  noise(out, rand, { at, type: 'low', f: body * jitter(rand, .1), to: body * .33, time: .03 * size, decay: 34 / size, gain: .75 });
  tone(out, { at, f: low * jitter(rand, .05), to: low * .45, time: .045 * size, decay: 28 / size, gain: .45 });
  noise(out, rand, { at: at + .008, type: 'band', f: 620, q: .7, decay: 9 / size, gain: .1, color: .4 });
  if (clank) {
    tone(out, { at: at + clank, f: 2400 * jitter(rand, .05), decay: 60, gain: .05, shape: 'square', duty: .3 });
    tone(out, { at: at + clank + .003, f: 3700 * jitter(rand, .05), decay: 70, gain: .04 });
  }
}
// Unity: phase-modulated zap with a falling pitch, a square-wave body and high sizzle.
function pulseShot(out, rand, at, { high = 1900, low = 420, time = .06, decay = 30, fm = .8, ratio = 2.01, body = 260, sub = 0, gain = .5 }) {
  const h = high * jitter(rand, .04);
  tone(out, { at, f: h, to: low, time, decay, gain, fm, ratio });
  tone(out, { at, f: body, to: body / 2, time: .05, decay: 40, gain: .12, shape: 'square', duty: .4 });
  noise(out, rand, { at, type: 'high', f: 5200, decay: 80, gain: .14 });
  if (sub) tone(out, { at, f: sub, to: sub * .55, time: .05, decay: 26, gain: .4 });
}
function blast(out, rand, at, { size = 1, crack = 1800, body = 520, sub = 75, metal = 0, debris = .15 }) {
  noise(out, rand, { at, type: 'high', f: crack, decay: 50 / size, gain: .8 });
  noise(out, rand, { at, type: 'low', f: body, to: body * .24, time: .1 * size, decay: 5.5 / size, gain: .95, color: .6 });
  tone(out, { at, f: sub, to: sub * .48, time: .14 * size, decay: 8 / size, gain: .6 });
  if (metal) { tone(out, { at, f: 310 * metal, decay: 5, gain: .05 }); tone(out, { at, f: 742 * metal, decay: 7, gain: .04 }); }
  if (debris) noise(out, rand, { at: at + .05 * size, type: 'band', f: 2600, q: .6, attack: .02, decay: 7 / size, gain: debris, grain: .45, grainRate: 70 });
}
function launch(out, rand, at, { pop = 900, thump = 120, from = 500, to = 2600, gain = .5 }) {
  noise(out, rand, { at, type: 'band', f: pop, q: 1, decay: 60, gain: .6 });
  tone(out, { at, f: thump, to: thump / 2, time: .05, decay: 25, gain: .35 });
  noise(out, rand, { at: at + .01, type: 'band', f: from, to, time: .35, q: 1.2, attack: .04, decay: 4, gain, length: .5 });
}

// Recipes: bus/category for the mixer, duration in seconds, variants, peak level, playback gain, rate jitter,
// per-group cooldown and how strongly the cue ducks combat and music. render(out, rand, variant) adds into out.
const R = Object.create(null);
const ui = (duration, render, extra = {}) => ({ bus: 'ui', category: 'ui', duration, render, level: .8, ...extra });
const weapon = (duration, render, extra = {}) => ({ bus: 'weapons', category: 'weapon', duration, variants: 3, jitter: .045, cooldown: .05, level: .92, render, ...extra });
const impact = (duration, render, extra = {}) => ({ bus: 'impacts', category: 'impact', duration, variants: 2, jitter: .05, cooldown: .06, level: .92, render, ...extra });
const alert = (duration, render, extra = {}) => ({ bus: 'alerts', category: 'alert', duration, cooldown: .4, duck: .5, level: .82, render, ...extra });

// Interface feedback.
R.select = ui(.1, (o, r) => { tone(o, { f: 1650, decay: 50, gain: .22 }); tone(o, { f: 3300, decay: 70, gain: .06 }); noise(o, r, { type: 'high', f: 4000, decay: 120, gain: .08 }); });
R.order = ui(.2, (o, r) => { tone(o, { f: 660, decay: 34, gain: .17 }); tone(o, { at: .055, f: 990, decay: 30, gain: .15 }); noise(o, r, { type: 'band', f: 1800, decay: 45, gain: .04 }); });
R.attackOrder = ui(.22, (o, r) => {
  tone(o, { f: 330, decay: 26, gain: .16, shape: 'square', duty: .35 }); tone(o, { at: .07, f: 495, decay: 24, gain: .15, shape: 'square', duty: .35 });
  noise(o, r, { type: 'high', f: 2600, decay: 70, gain: .06 }); noise(o, r, { at: .07, type: 'high', f: 2600, decay: 70, gain: .06 });
}, { level: .74 });
R.harvestOrder = ui(.26, o => { bell(o, { f: 2100, gain: .18, decay: 14 }); bell(o, { at: .07, f: 2650, gain: .13, decay: 16 }); });
R.rally = ui(.42, o => { tone(o, { f: 880, decay: 9, gain: .2, fm: .3, ratio: 2 }); tone(o, { at: .12, f: 880, decay: 11, gain: .07 }); tone(o, { at: .24, f: 880, decay: 14, gain: .025 }); });
R.error = ui(.24, o => { tone(o, { f: 190, to: 120, time: .2, decay: 12, gain: .2, shape: 'square', duty: .45 }); tone(o, { f: 205, decay: 16, gain: .08 }); }, { level: .7 });
R.cancel = ui(.15, o => { tone(o, { f: 620, decay: 30, gain: .14 }); tone(o, { at: .05, f: 415, decay: 30, gain: .12 }); }, { level: .6 });
R.group = ui(.11, o => { tone(o, { f: 1200, decay: 60, gain: .14 }); tone(o, { at: .035, f: 1520, decay: 60, gain: .12 }); }, { level: .6 });
R.buildStart = ui(.5, (o, r) => { noise(o, r, { type: 'low', f: 260, decay: 8, gain: .38, color: .8 }); tone(o, { f: 115, to: 230, time: .3, decay: 10, gain: .18 }); noise(o, r, { type: 'high', f: 2600, decay: 65, gain: .14 }); tone(o, { at: .12, f: 1700, decay: 40, gain: .04, shape: 'square', duty: .3 }); });
R.buildComplete = ui(.65, (o, r) => { tone(o, { f: 330, decay: 7, gain: .14 }); tone(o, { at: .12, f: 440, decay: 8, gain: .14 }); tone(o, { at: .24, f: 660, decay: 8, gain: .12 }); noise(o, r, { type: 'band', f: 2400, decay: 30, gain: .05 }); });
R.unitReady = ui(.48, o => { tone(o, { f: 440, decay: 12, gain: .15 }); tone(o, { at: .085, f: 587.3, decay: 12, gain: .13 }); tone(o, { at: .17, f: 880, decay: 12, gain: .12 }); });
R.delivery = ui(.4, (o, r) => { bell(o, { f: 1320, gain: .12, decay: 14 }); bell(o, { at: .085, f: 1980, gain: .1, decay: 16 }); noise(o, r, { type: 'low', f: 200, decay: 15, gain: .16, color: .7 }); }, { cooldown: .5 });
R.sell = ui(.48, o => { [2640, 2350, 2090, 1760, 1570].forEach((f, i) => bell(o, { at: i * .055, f, gain: .1 - i * .012, decay: 22, partials: [1, 2.4] })); });
R.repair = ui(.45, (o, r) => { noise(o, r, { type: 'band', f: 3200, q: 1.5, decay: 5, gain: .3, grain: .5, grainRate: 140 }); tone(o, { f: 120, decay: 6, gain: .08, shape: 'square', duty: .5 }); }, { level: .65 });

// Organics weapons: obsolete powder arms with gritty reports and mechanical tails.
R['organics.rifle'] = weapon(.34, (o, r) => { for (let i = 0; i < 3; i++) powderRound(o, r, i * .075 + (r() - .5) * .012, { clank: i === 2 ? .085 : 0 }); }, { cooldown: .06 });
R['organics.scout'] = weapon(.3, (o, r) => { for (let i = 0; i < 4; i++) powderRound(o, r, i * .056 + (r() - .5) * .008, { crack: 3200, body: 1250, low: 185, size: .8 }); }, { level: .82 });
R['organics.striker'] = weapon(.36, (o, r) => { for (let i = 0; i < 2; i++) powderRound(o, r, i * .09, { crack: 2000, body: 700, low: 110, size: 1.3, clank: .06 }); });
R['organics.tank'] = weapon(.8, (o, r) => {
  blast(o, r, 0, { size: 1, crack: 1800, body: 500, sub: 75, debris: 0 });
  bell(o, { f: 380 * jitter(r, .04), gain: .07, decay: 6, partials: [1, 2.29, 3.52], fm: 0 });
  noise(o, r, { at: .05, type: 'low', f: 250, decay: 4, gain: .25, color: .7 });
}, { drive: 1.8, cooldown: .12 });
R['organics.artillery'] = weapon(1, (o, r) => {
  blast(o, r, 0, { size: 1.4, crack: 1500, body: 420, sub: 60, debris: 0 });
  noise(o, r, { at: .08, type: 'low', f: 180, decay: 2.6, gain: .35, color: .8 });
  tone(o, { at: .05, f: 1450, decay: 18, gain: .06, shape: 'square', duty: .3 });
}, { drive: 1.6, cooldown: .2 });
R['organics.rocket'] = weapon(.62, (o, r) => launch(o, r, 0, {}), { cooldown: .12 });
R['organics.rocketTower'] = weapon(.78, (o, r) => { launch(o, r, 0, { thump: 100 }); launch(o, r, .18, { thump: 95, gain: .42 }); }, { cooldown: .16 });
R['organics.turret'] = weapon(.46, (o, r) => {
  powderRound(o, r, 0, { crack: 2200, body: 600, low: 120, size: 1.5 });
  tone(o, { f: 220, to: 110, time: .1, decay: 12, gain: .14, shape: 'saw' }); tone(o, { f: 120, decay: 8, gain: .1 });
}, { cooldown: .12 });

// AI Unity weapons: pulse, rail and FM timbres per role.
R['aiUnity.rifle'] = weapon(.26, (o, r) => { pulseShot(o, r, 0, {}); pulseShot(o, r, .1, { gain: .42 }); }, { cooldown: .06 });
R['aiUnity.scout'] = weapon(.24, (o, r) => { for (let i = 0; i < 3; i++) pulseShot(o, r, i * .06, { high: 2800, low: 1100, time: .035, decay: 45, fm: .5, ratio: 3, body: 400, gain: .42 }); }, { level: .82 });
R['aiUnity.striker'] = weapon(.3, (o, r) => { for (let i = 0; i < 2; i++) pulseShot(o, r, i * .08, { high: 1300, low: 300, time: .07, decay: 25, fm: 1.2, ratio: 1.5, body: 180, sub: 90, gain: .55 }); });
R['aiUnity.tank'] = weapon(.66, (o, r) => {
  noise(o, r, { type: 'high', f: 3000, decay: 120, gain: 1 }); noise(o, r, { type: 'low', f: 800, to: 200, time: .06, decay: 25, gain: .5 });
  tone(o, { f: 3200, to: 700, time: .25, decay: 6, gain: .12, shape: 'saw' }); tone(o, { f: 70, to: 40, time: .1, decay: 12, gain: .55 });
  noise(o, r, { type: 'band', f: 1200, q: 4, decay: 10, gain: .12 });
}, { drive: 1.4, cooldown: .12 });
R['aiUnity.artillery'] = weapon(.96, (o, r) => {
  tone(o, { f: 300, to: 2200, time: .28, attack: .28, curve: 2, decay: 60, gain: .22 });
  noise(o, r, { at: .28, type: 'high', f: 2500, decay: 70, gain: .9 }); noise(o, r, { at: .28, type: 'low', f: 450, to: 100, time: .12, decay: 6, gain: .8, color: .5 });
  tone(o, { at: .28, f: 65, to: 30, time: .15, decay: 6, gain: .6 }); noise(o, r, { at: .28, type: 'band', f: 3000, q: 3, decay: 15, gain: .2, grain: .5 });
}, { drive: 1.4, cooldown: .2 });
R['aiUnity.rocket'] = weapon(.56, (o, r) => {
  tone(o, { f: 95, to: 55, time: .06, decay: 30, gain: .5 }); noise(o, r, { type: 'band', f: 1500, q: .7, decay: 30, gain: .5 });
  tone(o, { f: 1200, to: 2400, time: .05, length: .06, decay: 1, gain: .08, shape: 'square', duty: .3 });
  noise(o, r, { at: .02, type: 'band', f: 700, to: 2200, time: .3, attack: .03, decay: 5, gain: .35 });
}, { cooldown: .12 });
R['aiUnity.turret'] = weapon(.46, (o, r) => { noise(o, r, { type: 'high', f: 3500, decay: 140, gain: 1 }); tone(o, { f: 6000, to: 2800, time: .2, decay: 7, gain: .12 }); noise(o, r, { type: 'low', f: 500, decay: 30, gain: .4 }); }, { cooldown: .12 });
R['aiUnity.rocketTower'] = weapon(.76, (o, r) => {
  for (const [at, f] of [[0, 1700], [.16, 1900]]) {
    tone(o, { at, f, to: f * 1.53, time: .08, decay: 9, gain: .26, fm: 2.2, ratio: 1.414 });
    noise(o, r, { at: at + .02, type: 'band', f: 600, to: 2400, time: .3, attack: .03, decay: 5, gain: .3 });
    tone(o, { at, f: 100, to: 55, time: .05, decay: 25, gain: .3 });
  }
}, { cooldown: .16 });

// Impacts and deaths, sized by what was hit.
R['impact.rocket'] = impact(.8, (o, r) => blast(o, r, 0, { size: .8, crack: 2000, body: 600, sub: 80, debris: .2 }));
R['impact.rocketHeavy'] = impact(1.1, (o, r) => blast(o, r, 0, { size: 1.2, crack: 1700, body: 520, sub: 70, debris: .25 }));
R['impact.shell'] = impact(1.2, (o, r) => {
  tone(o, { f: 55, to: 30, time: .15, decay: 6, gain: .8 }); noise(o, r, { type: 'low', f: 1200, to: 300, time: .3, decay: 5, gain: .7, color: .4 });
  noise(o, r, { type: 'high', f: 1500, decay: 40, gain: .6 }); noise(o, r, { at: .08, type: 'band', f: 3000, q: .5, attack: .1, decay: 4, gain: .15, grain: .5, grainRate: 60 });
}, { drive: 1.5, cooldown: .08 });
R['impact.whistle'] = impact(.36, (o, r) => { tone(o, { f: 2400, to: 800, time: .33, attack: .05, decay: 1.5, gain: .25, vibrato: .01 }); noise(o, r, { type: 'band', f: 2000, to: 800, time: .33, q: 6, attack: .05, decay: 2, gain: .05 }); }, { variants: 1, cooldown: .15, level: .6 });
R['death.infantry'] = impact(.45, (o, r) => {
  tone(o, { f: 120, to: 70, time: .06, decay: 25, gain: .5 }); noise(o, r, { type: 'band', f: 1800, q: 1.2, decay: 30, gain: .3 });
  [[.04, 2600], [.09, 3100], [.13, 2200]].forEach(([at, f]) => tone(o, { at: at + r() * .02, f: f * jitter(r, .1), decay: 70, gain: .06, shape: 'square', duty: .3 }));
}, { level: .78 });
R['death.robot'] = impact(.55, (o, r) => {
  tone(o, { f: 400, to: 80, time: .15, decay: 10, gain: .15, shape: 'square', duty: .4 }); crush(o, 4, 3, 0, Math.round(.2 * RATE));
  noise(o, r, { type: 'high', f: 5000, decay: 40, gain: .3, grain: .5, grainRate: 200 }); noise(o, r, { type: 'band', f: 900, q: 2, decay: 20, gain: .4 });
}, { level: .8 });
R['death.vehicle'] = impact(1, (o, r) => blast(o, r, 0, { size: 1.1, metal: jitter(r, .06), debris: .15 }), { drive: 1.5 });
R['death.small'] = impact(1, (o, r) => {
  blast(o, r, 0, { size: 1, crack: 1400, body: 380, sub: 62, debris: .3 });
  noise(o, r, { at: .15, type: 'low', f: 220, decay: 3.5, gain: .3, color: .8 });
}, { variants: 1, drive: 1.4 });
R['death.building'] = impact(2.6, (o, r) => {
  blast(o, r, 0, { size: 1.6, crack: 1300, body: 400, sub: 55, metal: .8, debris: .2 });
  noise(o, r, { at: .05, type: 'low', f: 150, attack: .12, decay: 1.1, gain: .85, color: .9 });
  tone(o, { at: .25, f: 92, to: 58, time: .9, attack: .05, decay: 2, gain: .06, shape: 'saw' });
  for (let i = 0; i < 18; i++) noise(o, r, { at: .2 + r() * 1.8, type: 'band', f: 1500 + r() * 2500, q: 1.4, decay: 40, gain: .05 + r() * .08 });
  tone(o, { at: 1.15 + r() * .2, f: 50, decay: 6, gain: .3 }); noise(o, r, { at: 1.15, type: 'low', f: 400, decay: 4, gain: .25, color: .6 });
}, { variants: 1, drive: 1.3, cooldown: .25 });

// Alert stingers: centred, never dropped, each with its own cooldown.
R['alert.underAttack'] = alert(.8, (o, r) => {
  for (const [at, f] of [[0, 520], [.32, 440]]) {
    tone(o, { at, f: f * .85, to: f, time: .04, length: .22, decay: 1, gain: .2, shape: 'square', duty: .5 });
    tone(o, { at, f: f * 1.26 * .85, to: f * 1.26, time: .04, length: .22, decay: 1, gain: .12, shape: 'square', duty: .4 });
    tone(o, { at, f: 110, decay: 20, gain: .2 });
  }
  noise(o, r, { type: 'band', f: 2200, decay: 30, gain: .05 });
}, { cooldown: 5, duck: .65 });
// Every friendly loss is an event: a sparse, lightly ducking cue keeps a long fight from pumping the mix.
R['alert.unitLost'] = alert(.7, (o, r) => {
  noise(o, r, { type: 'band', f: 2200, decay: 25, gain: .2 });
  tone(o, { at: .03, f: 660, length: .14, decay: 6, gain: .22, tremolo: .4 }); tone(o, { at: .17, f: 440, length: .14, decay: 6, gain: .22, tremolo: .4 });
  noise(o, r, { at: .3, type: 'band', f: 3000, q: .5, decay: 12, gain: .15, grain: .6, grainRate: 160 });
}, { cooldown: 6, duck: .2 });
R['alert.structureLost'] = alert(.95, (o, r) => {
  [392, 330, 262].forEach((f, i) => tone(o, { at: i * .17, f, length: .16, decay: 4, gain: .25, shape: 'tri' }));
  noise(o, r, { at: .3, type: 'low', f: 200, decay: 3, gain: .3, color: .8 });
}, { cooldown: 2.5, duck: .55 });
R['alert.research'] = alert(.9, (o, r) => { [784, 988, 1319].forEach((f, i) => bell(o, { at: i * .12, f, gain: .2, decay: 4, partials: [1, 3.5, 6.1], fm: 1.6 })); noise(o, r, { type: 'high', f: 6000, decay: 6, gain: .03 }); }, { duck: .35 });
R['alert.upgrade'] = alert(.75, (o, r) => { bell(o, { f: 587, gain: .18, decay: 5 }); bell(o, { at: .12, f: 880, gain: .17, decay: 5 }); noise(o, r, { at: .3, type: 'band', f: 3000, decay: 80, gain: .3 }); tone(o, { at: .3, f: 1500, decay: 60, gain: .1, shape: 'square', duty: .3 }); }, { duck: .35 });
R['alert.promotion'] = alert(1, o => { brass(o, { f: 523.25, length: .5, release: .3, gain: .2 }); brass(o, { at: .1, f: 783.99, length: .45, release: .3, gain: .17, bright: 2800 }); bell(o, { at: .1, f: 1568, gain: .05, decay: 5 }); }, { duck: .35 });
R['alert.powerDown'] = alert(1.1, o => { brass(o, { f: 900, to: 110, time: .9, attack: .01, length: .85, release: .15, gain: .2, bright: 3000, dark: 300, vibrato: 0 }); tone(o, { f: 900, to: 110, time: .9, decay: 1.6, gain: .1 }); tone(o, { at: .85, f: 60, decay: 20, gain: .4 }); }, { cooldown: 3, duck: .5 });
R['alert.powerUp'] = alert(.95, (o, r) => { noise(o, r, { type: 'band', f: 2500, decay: 80, gain: .25 }); tone(o, { f: 140, to: 900, time: .6, attack: .05, decay: 2, gain: .2 }); tone(o, { f: 110, length: .5, decay: 3, gain: .08, shape: 'square', duty: .5 }); }, { cooldown: 3, duck: .35 });
R['alert.reserve'] = alert(.6, o => { tone(o, { f: 330, length: .12, decay: 4, gain: .22, shape: 'tri', tremolo: .5, tremoloRate: 24 }); tone(o, { at: .2, f: 330, length: .12, decay: 4, gain: .22, shape: 'tri', tremolo: .5, tremoloRate: 24 }); }, { cooldown: 3, duck: .35 });
R['alert.objective'] = alert(1, o => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(o, { at: i * .09, f, gain: .18, decay: 3.5, partials: [1, 2.01, 3.98], fm: .4 })); tone(o, { f: 130.8, attack: .02, decay: 3, gain: .2 }); }, { duck: .55 });
R['alert.objectiveNew'] = alert(.65, o => { tone(o, { f: 880, decay: 6, gain: .22, fm: .3, ratio: 2 }); tone(o, { at: .12, f: 1174.7, decay: 6, gain: .2, fm: .3, ratio: 2 }); }, { duck: .45 });
R['alert.objectiveFailed'] = alert(1, o => { tone(o, { f: 466, decay: 3, gain: .18, shape: 'tri' }); tone(o, { f: 440, decay: 3, gain: .18, shape: 'tri' }); tone(o, { at: .25, f: 349, decay: 2.5, gain: .18, shape: 'tri' }); tone(o, { at: .25, f: 330, decay: 2.5, gain: .18, shape: 'tri' }); tone(o, { at: .25, f: 70, decay: 10, gain: .35 }); }, { duck: .6 });
R['alert.wave'] = alert(1.5, (o, r) => { brass(o, { f: 110, attack: .25, length: 1, release: .3, gain: .24, bright: 1400, dark: 200, vibrato: .01 }); brass(o, { f: 164.8, attack: .3, length: .95, release: .3, gain: .17, bright: 1500, dark: 220, vibrato: .01 }); tone(o, { f: 60, decay: 8, gain: .4 }); noise(o, r, { type: 'low', f: 300, decay: 6, gain: .2 }); }, { cooldown: 4, duck: .65 });
R['alert.enemySpotted'] = alert(.8, o => { tone(o, { f: 1200, decay: 5, gain: .3, fm: .2, ratio: 1.5 }); tone(o, { at: .22, f: 1200, decay: 7, gain: .1 }); tone(o, { at: .44, f: 1200, decay: 9, gain: .04 }); }, { cooldown: 3, duck: .45 });
R['alert.warning'] = alert(.45, o => { tone(o, { f: 760, length: .09, decay: 5, gain: .16, shape: 'square', duty: .4 }); tone(o, { at: .15, f: 760, length: .09, decay: 5, gain: .16, shape: 'square', duty: .4 }); }, { cooldown: 2, duck: .35 });
R['alert.explored'] = alert(.5, o => { tone(o, { f: 660, decay: 7, gain: .18 }); tone(o, { at: .1, f: 990, decay: 7, gain: .16 }); }, { cooldown: 2, duck: .2, level: .6 });

// Abilities, one per role and race. Organics are mechanical and analog; Unity is servo, digital and FM.
const ability = (render, duration = .62) => ({ bus: 'ui', category: 'alert', duration, render, cooldown: .25, duck: .25, level: .8 });
R['organics.digIn'] = ability((o, r) => { for (let i = 0; i < 3; i++) { noise(o, r, { at: i * .12, type: 'band', f: 2500, q: 2, decay: 25, gain: .3 }); tone(o, { at: i * .12 + .05, f: 90, to: 60, time: .04, decay: 30, gain: .35 }); noise(o, r, { at: i * .12 + .05, type: 'low', f: 400, decay: 30, gain: .3, color: .5 }); } });
R['aiUnity.digIn'] = ability((o, r) => { for (const at of [0, .15]) { tone(o, { at, f: 220, to: 110, time: .05, length: .07, decay: 4, gain: .12, shape: 'square', duty: .4 }); noise(o, r, { at, type: 'band', f: 1200, decay: 60, gain: .3 }); } tone(o, { at: .2, f: 120, attack: .1, decay: 3, gain: .1 }); tone(o, { at: .2, f: 180, attack: .1, decay: 3, gain: .06 }); });
R['organics.longShot'] = ability(o => { [[0, 1400], [.1, 1400], [.2, 1870]].forEach(([at, f]) => tone(o, { at, f, length: .06, decay: 4, gain: .2 })); }, .5);
R['aiUnity.longShot'] = ability(o => { for (let i = 0; i < 8; i++) tone(o, { at: i * .025, f: i % 2 ? 2500 : 2000, length: .025, decay: 1, gain: .14, shape: 'square', duty: .3 }); crush(o, 5, 2); }, .5);
R['organics.flare'] = ability((o, r) => { noise(o, r, { type: 'band', f: 1500, decay: 60, gain: .5 }); tone(o, { f: 300, decay: 40, gain: .3 }); noise(o, r, { at: .03, type: 'band', f: 3000, to: 1800, time: .6, q: 1.2, attack: .05, decay: 1.8, gain: .25, length: .7 }); }, .8);
R['aiUnity.flare'] = ability(o => { tone(o, { f: 1800, to: 900, time: .4, decay: 4, gain: .26, fm: .4, ratio: 1.5 }); for (let i = 0; i < 3; i++) tone(o, { at: .3 + i * .08, f: 2400, length: .03, decay: 1, gain: .08, shape: 'square', duty: .3 }); }, .8);
R['organics.overdrive'] = ability((o, r) => { brass(o, { f: 55, to: 110, time: .4, attack: .05, length: .45, release: .2, gain: .3, bright: 1200, dark: 300, vibrato: .02 }); noise(o, r, { type: 'low', f: 200, attack: .05, decay: 2.5, gain: .3, color: .8 }); }, .72);
R['aiUnity.overdrive'] = ability(o => { tone(o, { f: 400, to: 2400, time: .5, attack: .03, decay: 1.5, gain: .2 }); tone(o, { f: 100, to: 200, time: .5, decay: 2, gain: .08, shape: 'square', duty: .4 }); }, .72);
R['organics.afterburner'] = ability((o, r) => { noise(o, r, { type: 'band', f: 400, to: 1800, time: .3, attack: .05, decay: 2.5, gain: .45 }); noise(o, r, { type: 'low', f: 160, attack: .05, decay: 3, gain: .35, color: .8 }); });
R['aiUnity.afterburner'] = ability((o, r) => { tone(o, { f: 300, to: 1500, time: .35, attack: .03, decay: 2.5, gain: .14, shape: 'saw' }); noise(o, r, { type: 'high', f: 4000, attack: .05, decay: 4, gain: .12 }); });
R['organics.barrage'] = ability((o, r) => { noise(o, r, { type: 'band', f: 2200, decay: 30, gain: .25 }); tone(o, { at: .02, f: 1000, length: .08, decay: 3, gain: .1, shape: 'square', duty: .5 }); tone(o, { at: .15, f: 80, decay: 20, gain: .3 }); tone(o, { at: .3, f: 76, decay: 20, gain: .26 }); }, .55);
R['aiUnity.barrage'] = ability(o => { for (let i = 0; i < 4; i++) tone(o, { at: i * .05, f: 1500, to: 2500, time: .04, length: .04, decay: 1, gain: .14, shape: 'square', duty: .3 }); tone(o, { at: .22, f: 300, to: 150, time: .2, decay: 8, gain: .2 }); }, .55);
R['organics.fieldPatch'] = ability((o, r) => { noise(o, r, { type: 'band', f: 3200, q: 1.5, decay: 4, gain: .35, grain: .55, grainRate: 150 }); for (let i = 0; i < 3; i++) tone(o, { at: .3 + i * .06, f: 1800, decay: 80, gain: .1, shape: 'square', duty: .3 }); });
R['aiUnity.fieldPatch'] = ability(o => { for (let i = 0; i < 5; i++) tone(o, { at: i * .07, f: 2000 + i * 230, to: 2600 + i * 180, time: .1, decay: 9, gain: .1, fm: .5, ratio: 1.5, tremolo: .4, tremoloRate: 40 }); });

// Victory and defeat: longer stingers that play over the fading soundtrack.
R.victory = {
  bus: 'alerts', category: 'alert', duration: 3.6, level: .85, duck: .6, render(o, r) {
    [[0, 261.63, .22], [.22, 392, .22], [.44, 523.25, .5]].forEach(([at, f, length]) => brass(o, { at, f, length, release: .2, gain: .2, bright: 2600 }));
    for (const f of [261.63, 329.63, 392, 523.25]) brass(o, { at: .95, f, attack: .12, length: 1.6, release: .9, gain: .12, bright: 2200, dark: 300 });
    for (let i = 0; i < 6; i++) { tone(o, { at: .7 + i * .045, f: 65.4, decay: 9, gain: .1 + i * .03 }); noise(o, r, { at: .7 + i * .045, type: 'low', f: 300, decay: 18, gain: .06 }); }
    tone(o, { at: .95, f: 65.4, decay: 3, gain: .5 }); noise(o, r, { at: .95, type: 'low', f: 260, decay: 6, gain: .3, color: .5 });
    noise(o, r, { at: .6, type: 'high', f: 6500, attack: .35, curve: 2, decay: 2.2, gain: .08 });
  },
};
R.defeat = {
  bus: 'alerts', category: 'alert', duration: 3.6, level: .85, duck: .6, render(o, r) {
    brass(o, { f: 110, attack: .4, length: 2.4, release: .9, gain: .14, bright: 700, dark: 150, vibrato: .004 });
    brass(o, { f: 164.81, attack: .5, length: 2.2, release: .9, gain: .09, bright: 800, dark: 160, vibrato: .004 });
    [[.15, 440], [.75, 349.23], [1.4, 293.66]].forEach(([at, f]) => { bell(o, { at, f, gain: .16, decay: 1.6, partials: [1, 2.01, 3], fm: .2 }); brass(o, { at, f, length: .45, release: .4, gain: .08, bright: 1500 }); });
    noise(o, r, { at: .3, type: 'low', f: 140, attack: .6, decay: 1.2, gain: .35, color: .9 });
    tone(o, { at: 2.1, f: 48, decay: 4, gain: .45 }); noise(o, r, { at: 2.1, type: 'low', f: 300, decay: 5, gain: .2 });
  },
};

// Ambient beds loop seamlessly and never count as voices.
const bed = (duration, render) => ({ bus: 'ambient', category: 'ambient', loop: true, duration, render, level: .7 });
R['ambient.wind'] = bed(6, (o, r) => {
  const n = o.length, overlap = Math.round(.8 * RATE), raw = new Float32Array(n + overlap);
  const sweep = new Filter(500, .9), whistle = new Filter(1900, 6), state = r.state;
  let brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = i / RATE, cycle = TAU * t / 6;
    if (i % 32 === 0) { sweep.set(520 + 260 * Math.sin(cycle) + 120 * Math.sin(3 * cycle + 1)); whistle.set(1900 + 300 * Math.sin(2 * cycle + .5)); }
    const white = nextRandom(state) * 2 - 1; brown = brown * .985 + white * .15;
    const u = t / 6 % 1, gust = .55 + .3 * sin1((u + .048) % 1) + .15 * sin1(5 * u % 1);
    sweep.step(brown * 3); whistle.step(white);
    raw[i] = gust * (sweep.band * .9 + whistle.band * .05 * Math.max(0, sin1(2 * u % 1)));
  }
  o.set(loopFold(raw, overlap));
});
R['ambient.lava'] = bed(5, (o, r) => {
  const n = o.length, overlap = Math.round(.6 * RATE), raw = new Float32Array(n + overlap), rumble = new Filter(110, .7), state = r.state;
  let brown = 0;
  for (let i = 0; i < raw.length; i++) { const white = nextRandom(state) * 2 - 1; brown = brown * .99 + white * .1; raw[i] = rumble.step(brown * 4) * (.8 + .2 * sin1(i / RATE / 2.5 % 1)); }
  const bed = loopFold(raw, overlap);
  const bubbles = wrapped(n, scratch => {
    for (let i = 0; i < 9; i++) {
      const at = r() * 5, f = 140 + r() * 160;
      tone(scratch, { at, f, to: f * (2.5 + r()), time: .04 + r() * .03, decay: 26, gain: .25 + r() * .2 });
      noise(scratch, r, { at, type: 'low', f: 380, decay: 30, gain: .12 });
    }
    for (let i = 0; i < 26; i++) noise(scratch, r, { at: r() * 5, type: 'high', f: 3500, decay: 160, gain: .04 + r() * .05 });
  });
  for (let i = 0; i < n; i++) o[i] = bed[i] + bubbles[i];
});
R['ambient.industry'] = bed(4, (o, r) => {
  const n = o.length, hum = new Filter(900, .7);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    // Every partial completes whole cycles over 4 s, so the loop point is seamless without a crossfade.
    const buzz = wave(SQUARE, (110 * t) % 1, 110 / RATE, .5);
    o[i] = .3 * sin1(55 * t % 1) + .2 * sin1(110.25 * t % 1) + .08 * sin1(165 * t % 1) + .12 * hum.step(buzz) * (.7 + .3 * sin1(t / 2 % 1));
  }
  const clatter = wrapped(n, scratch => {
    for (let i = 0; i < 24; i++) { const at = i / 6 + (r() - .5) * .02; tone(scratch, { at, f: 1400 + r() * 300, decay: 60, gain: .05 + .02 * (i % 2), shape: 'square', duty: .3 }); noise(scratch, r, { at, type: 'band', f: 900, q: 2, decay: 50, gain: .06 }); }
    noise(scratch, r, { at: 1.3, type: 'high', f: 4500, attack: .15, decay: 3, gain: .06 });
  });
  for (let i = 0; i < n; i++) o[i] += clatter[i];
});

for (const [kind, recipe] of Object.entries(R)) recipe.kind = kind;
export const RECIPES = R;
export const SOUND_KINDS = Object.keys(R).filter(kind => !R[kind].loop);
export const AMBIENT_KINDS = Object.keys(R).filter(kind => R[kind].loop);
// Older call sites and role names resolve to a recipe; bare weapon roles take the Organics timbre.
export const ALIASES = Object.assign(Object.create(null), { confirm: 'order', build: 'buildStart', combat: 'organics.rifle', explosion: 'death.vehicle' });
for (const role of ['rifle', 'rocket', 'scout', 'tank', 'artillery', 'striker', 'turret', 'rocketTower']) ALIASES[role] = `organics.${role}`;

export function renderKind(kind, variant = 0) {
  const recipe = R[kind];
  if (!recipe) throw new RangeError(`Unknown sound ${kind}`);
  const out = new Float32Array(Math.max(1, Math.round(recipe.duration * RATE)));
  recipe.render(out, seededRandom(`${kind}#${variant}`), variant);
  return finish(out, { level: recipe.level, drive: recipe.drive, loop: recipe.loop });
}

// Unit acknowledgements: wordless, speech-like lines. Organics crews talk over squelched radio through
// two-formant syllables, the Vael launcher teams in a lower growling register, and Unity machines answer
// in bit-crushed chirp motifs. No real language is used.
export const VOICE_FAMILIES = ['human', 'vael', 'unity'];
export const VOICE_CONTEXTS = ['select', 'move', 'attack', 'attackMove', 'harvest', 'ready', 'ability', 'annoyed', 'transmission'];
export const VOICE_ROLES = ['rifle', 'rocket', 'scout', 'tank', 'artillery', 'striker', 'engineer', 'harvester', 'constructor'];
export const voiceFamily = (race, role) => race === 'aiUnity' ? 'unity' : role === 'rocket' ? 'vael' : 'human';
export const voiceKey = (family, role, context) => `voice.${family}.${role}.${context}`;
export function parseVoiceKey(key) {
  const [prefix, family, role, context] = String(key).split('.');
  return prefix === 'voice' && VOICE_FAMILIES.includes(family) && VOICE_ROLES.includes(role) && VOICE_CONTEXTS.includes(context) ? { family, role, context } : null;
}
export const VOICE_RECIPE = { bus: 'voice', category: 'voice', variants: 3, duck: .3, level: .8, cooldown: 0 };
export const TRANSMISSION_RECIPE = { bus: 'voice', category: 'alert', variants: 3, duck: .55, level: .8, cooldown: 1.5 };

const VOWELS = [[730, 1090], [530, 1840], [300, 2250], [570, 840], [440, 1020], [660, 1700], [400, 1900]];
const CONTOURS = {
  select: { syllables: [2, 3], tempo: 1, pitch: u => 1 + .22 * u * u },
  move: { syllables: [2, 3], tempo: 1.05, pitch: u => 1.1 - .25 * u },
  attack: { syllables: [3, 3], tempo: 1.25, pitch: u => 1.24 - .1 * u - .5 * Math.max(0, u - .7) ** 2 },
  attackMove: { syllables: [3, 4], tempo: 1.15, pitch: u => 1.14 - .14 * u },
  harvest: { syllables: [2, 2], tempo: .88, pitch: u => 1.02 - .06 * u },
  ready: { syllables: [3, 3], tempo: 1, pitch: u => 1 + .18 * Math.sin(Math.PI * u) },
  ability: { syllables: [2, 3], tempo: 1.2, pitch: u => 1.26 - .22 * u },
  annoyed: { syllables: [4, 5], tempo: .92, pitch: u => 1 + .3 * Math.sin(3 * Math.PI * u) },
  transmission: { syllables: [6, 8], tempo: .95, pitch: u => 1.05 - .12 * u + .05 * Math.sin(9 * u) },
};
// Crew pitch (Hz) and pace per role; Unity uses the same table for its motif register.
const VOICES = {
  rifle: [140, 1], rocket: [82, .82], scout: [162, 1.18], tank: [112, .9], artillery: [120, .86],
  striker: [150, 1.12], engineer: [132, 1], harvester: [104, .8], constructor: [118, .85],
};

function radio(out, rand, from, to, { low = 330, high = 3300, drive = 2.6, hiss = .018 }) {
  const hp = new Filter(low, .7), lp = new Filter(high, .7), band = new Filter(2400, .6), state = rand.state;
  for (let i = from; i < to; i++) {
    hp.step(out[i]); const x = lp.step(hp.high);
    band.step(nextRandom(state) * 2 - 1);
    out[i] = Math.tanh(x * drive) / drive * 1.6 + band.band * hiss;
  }
}
function squelch(out, rand, at, gain = .35) {
  noise(out, rand, { at, type: 'band', f: 2500, q: .7, attack: .002, decay: 45, gain });
  tone(out, { at, f: 1900, decay: 120, gain: gain * .4, shape: 'square', duty: .5 });
}

function humanLine(rand, role, context, family) {
  const shape = CONTOURS[context], [base, pace] = VOICES[role], vael = family === 'vael';
  const count = shape.syllables[0] + Math.floor(rand() * (shape.syllables[1] - shape.syllables[0] + 1));
  const tempo = shape.tempo * pace * (vael ? .85 : 1), syllables = [];
  let cursor = .05;
  for (let i = 0; i < count; i++) {
    const length = (.075 + rand() * .065) / tempo * (i === count - 1 ? 1.35 : 1);
    syllables.push({ at: cursor, length, vowel: pick(rand, VOWELS), onset: rand() < .55 ? pick(rand, ['plosive', 'fricative', 'plosive']) : '' });
    cursor += length + (rand() < .2 ? .04 : .012) / tempo;
  }
  const end = cursor + .02, out = new Float32Array(Math.round((end + .09) * RATE));
  const f1 = new Filter(700, 7), f2 = new Filter(1200, 11), f3 = new Filter(2600, 9), tilt = new Filter(1600, .6), formantScale = vael ? .82 : 1;
  const f0 = base * (vael ? 1 : jitter(rand, .06)), state = rand.state;
  let phase = 0, sub = 0, current = syllables[0].vowel.slice(), index = 0, contour = 1;
  for (let i = Math.round(.05 * RATE); i < Math.round(end * RATE); i++) {
    const t = i / RATE;
    while (index < syllables.length - 1 && t >= syllables[index + 1].at) index++;
    const syllable = syllables[index], local = t - syllable.at;
    const level = local < 0 || local > syllable.length ? 0 : Math.min(1, local / .015, (syllable.length - local) / .03);
    if (i % 16 === 0) {
      current[0] += (syllable.vowel[0] * formantScale - current[0]) * .2; current[1] += (syllable.vowel[1] * formantScale - current[1]) * .2;
      f1.set(current[0]); f2.set(current[1]); f3.set(2600 * formantScale);
      contour = shape.pitch(t / end);
    }
    const frequency = f0 * contour * (1 + .012 * sin1(5.5 * t % 1)) * (1 + (nextRandom(state) - .5) * .01);
    phase += frequency / RATE; if (phase >= 1) phase -= 1;
    let source = tilt.step(wave(SAW, phase, frequency / RATE, .5)) * 1.6 + (nextRandom(state) * 2 - 1) * .04;
    if (vael) {
      sub += frequency / 2 / RATE; if (sub >= 1) sub -= 1;
      source = source * (1 - .45 * (.5 + .5 * sin1(27 * t % 1))) + .35 * wave(SAW, sub, frequency / 2 / RATE, .5);
    }
    f1.step(source); f2.step(source); f3.step(source);
    out[i] = level * (f1.band + f2.band * .7 + f3.band * .22);
  }
  for (const syllable of syllables) {
    if (syllable.onset === 'plosive') noise(out, rand, { at: syllable.at - .004, type: 'high', f: 2000, decay: 160, gain: .35 });
    else if (syllable.onset === 'fricative') noise(out, rand, { at: syllable.at - .035, type: 'band', f: pick(rand, [4200, 2600]), q: 1.4, attack: .015, decay: 40, gain: .22, length: .045 });
  }
  if (context === 'annoyed') noise(out, rand, { at: .01, type: 'band', f: 1200, q: .5, attack: .03, decay: 25, gain: .12 });
  squelch(out, rand, 0, .3);
  radio(out, rand, 0, Math.round((end + .02) * RATE), vael ? { low: 220, high: 3000, drive: 3.2 } : {});
  squelch(out, rand, end + .005, .45);
  return out;
}

// Unity motifs step through a scale in the role's register; contexts change contour and rhythm.
const MOTIFS = {
  select: [[0, 1], [4, 1.4]], move: [[5, 1], [3, 1], [0, 1.4]], attack: [[7, .6], [7, .6], [9, .6], [7, 1.2]],
  attackMove: [[0, .7], [3, .7], [7, 1.2]], harvest: [[0, 1.5], [-2, 1.5]], ready: [[0, .8], [4, .8], [7, 1.6]],
  ability: [[0, .5], [5, .5], [0, .5], [9, 1.2]], annoyed: [[0, .5], [1, .5], [0, .5], [1, .5], [-5, 1.6]],
  transmission: [[0, .7], [3, .7], [5, .7], [2, .7], [7, .7], [3, .7], [0, .7], [5, .7], [-2, 1.4]],
};
const REGISTER = { rifle: 620, rocket: 280, scout: 1100, tank: 230, artillery: 320, striker: 860, engineer: 720, harvester: 340, constructor: 410 };
function unityLine(rand, role, context) {
  const scale = [0, 2, 3, 5, 7, 8, 10, 12], [, pace] = VOICES[role], base = REGISTER[role] * jitter(rand, .03);
  const notes = MOTIFS[context].map(([step, length]) => {
    const offset = rand() < .25 ? pick(rand, [-1, 1]) : 0, degree = Math.max(-7, Math.min(14, step + offset));
    const octave = Math.floor(degree / 7), semis = scale[((degree % 7) + 7) % 7] + octave * 12;
    return { f: base * 2 ** (semis / 12), length: length * .07 / pace };
  });
  let cursor = .02;
  for (const note of notes) { note.at = cursor; cursor += note.length + .012; }
  const out = new Float32Array(Math.round((cursor + .06) * RATE)), glitch = context === 'annoyed';
  for (const [index, note] of notes.entries()) {
    tone(out, { at: note.at, f: index ? notes[index - 1].f : note.f, to: note.f, time: .008, length: note.length, decay: 3, gain: .22, shape: 'square', duty: role === 'tank' || role === 'harvester' ? .5 : .28 });
    tone(out, { at: note.at, f: note.f * 2, length: note.length, decay: 6, gain: .08, fm: .6, ratio: 1.5 });
    if (role === 'engineer') tone(out, { at: note.at, f: note.f, to: note.f * 1.5, time: note.length, length: note.length, decay: 4, gain: .07 });
    noise(out, rand, { at: note.at, type: 'high', f: 5000, decay: 300, gain: .12 });
    if (glitch && rand() < .6) for (let k = 1; k < 3; k++) tone(out, { at: note.at + k * .018, f: note.f * 1.06, length: .012, decay: 1, gain: .15, shape: 'square', duty: .5 });
  }
  if (role === 'tank' || role === 'constructor') noise(out, rand, { at: .01, type: 'band', f: 600, q: 3, decay: 22, gain: .15 });
  crush(out, glitch ? 3 : 5, glitch ? 4 : 3);
  return out;
}

export function renderVoice(key, variant = 0) {
  const voice = parseVoiceKey(key);
  if (!voice) throw new RangeError(`Unknown voice ${key}`);
  const rand = seededRandom(`${key}#${variant}`);
  const out = voice.family === 'unity' ? unityLine(rand, voice.role, voice.context) : humanLine(rand, voice.role, voice.context, voice.family);
  return finish(out, { level: VOICE_RECIPE.level, fadeIn: .002 });
}
