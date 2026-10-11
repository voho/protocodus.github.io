// Ashline sound bank. Every effect is synthesized here from noise, oscillators, resonators and filters into
// mono PCM; no samples or recordings are used. The module never touches Web Audio, so node tests can render and
// inspect each recipe, and audio.js turns the arrays into buffers lazily, a few at a time, in idle slices.
// Each kind and variant has its own seed, so adding a recipe never changes the timbre of another.
// The palette is grim and physical: powder, steel and air for the Organics; magnetic cracks, plasma and arcs
// for AI Unity; low brass and drums for alerts; and a field console's muffled mechanics for the interface.

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

// Band-limited step correction keeps sawtooth and glottal sources from aliasing into hiss at 24 kHz.
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// Interpolated sine table: oscillators call it per sample, where Math.sin dominated the synthesis cost.
const TABLE = new Float32Array(4097);
for (let i = 0; i < TABLE.length; i++) TABLE[i] = Math.sin(TAU * i / 4096);
const sin1 = p => { const x = p * 4096, i = x | 0; return TABLE[i] + (TABLE[i + 1] - TABLE[i]) * (x - i); };
// Padé tanh for saturation: no transcendental call per sample, and smooth where it meets ±1 at ±3.
const soft = x => x >= 3 ? 1 : x <= -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x);

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

// Adds an enveloped sine whose frequency glides geometrically from f to `to`: thumps, subs and hums. Pitched
// voices with harmonics go through horn() and its filter instead.
function tone(out, { at = 0, f, to = f, time = 0, attack = .002, decay = 8, gain = .3 }) {
  const s = stepper({ at, length: 0, attack, decay, curve: 1, gain, f, to, time }, out);
  let phase = 0, amp = gain, frequency = s.glideSamples > 0 ? f : to;
  for (let i = s.from; i < s.stop; i++) {
    const n = i - s.start;
    let level;
    if (n < s.attackSamples) level = gain * n / s.attackSamples;
    else { level = amp; amp *= s.fall; if (amp < s.floor) break; }
    if (n > 0 && n <= s.glideSamples) frequency = n === s.glideSamples ? to : frequency * s.glideStep;
    phase += frequency / RATE; if (phase >= 1) phase -= Math.floor(phase);
    out[i] += level * sin1(phase);
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

// Damped modes struck by a short force pulse: steel parts, plates, shells, knocks and membranes. modes are
// [ratio, gain, decay/s]. A longer (softer) pulse cannot excite the high modes, as with a padded mallet, and
// grit roughens the contact. Two-pole resonators ring from silence, so strikes never click.
function modal(out, rand, { at = 0, f, modes, gain = .2, hard = .0005, grit = .25 }) {
  const start = Math.round(at * RATE), length = Math.max(1, Math.round(hard * RATE)), pulse = new Float32Array(length), state = rand.state;
  for (let i = 0; i < length; i++) pulse[i] = (sin1((i + .5) / (2 * length)) + grit * (nextRandom(state) * 2 - 1)) * Math.PI / (2 * length);
  for (const [ratio, level, decay] of modes) {
    const w = TAU * Math.min(f * ratio, RATE * .45) / RATE, r = Math.exp(-decay / RATE), a1 = 2 * r * Math.cos(w), r2 = r * r, b = gain * level * Math.sin(w);
    const stop = Math.min(out.length, start + length + Math.round(6.9 / decay * RATE));
    let y1 = 0, y2 = 0;
    for (let i = Math.max(0, start); i < stop; i++) {
      const n = i - start, y = (n < length ? b * pulse[n] : 0) + a1 * y1 - r2 * y2;
      y2 = y1; y1 = y; out[i] += y;
    }
  }
}
// Mode sets as [ratio, gain, decay multiple]: a free steel bar, a thick plate and a cylindrical shell.
const BAR = [[1, 1, 1], [2.76, .55, 1.6], [5.4, .3, 2.4], [8.93, .12, 3.4]];
const PLATE = [[1, 1, 1], [1.59, .7, 1.3], [2.14, .5, 1.7], [2.65, .35, 2.1], [3.15, .2, 2.6]];
const SHELL = [[1, 1, 1], [1.47, .75, 1.3], [2.09, .5, 1.8], [2.83, .3, 2.4], [3.6, .15, 2.9]];
const modes = (set, decay) => set.map(([ratio, gain, k]) => [ratio, gain, decay * k]);

// Low horn voice: three detuned saws and a sub-octave sine through a lowpass that opens with the swell and
// closes as it releases. Stacked, they make the stingers' brass and the filtered klaxons; bend sags or lifts
// the pitch over `time` (by default the whole note).
function horn(out, rand, { at = 0, f, bend = 1, time = 0, attack = .12, length = .6, release = .3, gain = .15, bright = 1100, dark = 200, q = .9, detune = .005, sub = .25, vibrato = .003 }) {
  const start = Math.round(at * RATE), hold = Math.round(length * RATE), attackSamples = Math.max(1, Math.round(attack * RATE));
  const stop = Math.min(out.length, start + hold + Math.round(release * RATE)), fall = Math.exp(-6.9 / Math.max(1, release * RATE));
  const glide = Math.max(1, Math.round((time || length + release) * RATE)), step = bend ** (16 / glide), low = 1 - detune, high = 1 + detune * .8;
  const filter = new Filter(dark, q), drift = rand();
  let p0 = rand(), p1 = rand(), p2 = rand(), p3 = rand(), d0 = 0, d1 = 0, d2 = 0, d3 = 0, frequency = f, level = 0;
  for (let i = Math.max(0, start); i < stop; i++) {
    const n = i - start;
    if (n >= hold) level *= fall;
    else if (n < attackSamples) { const x = n / attackSamples; level = x * Math.sqrt(x); }
    else level = 1 - .15 * (n - attackSamples) / Math.max(1, hold - attackSamples);
    if ((n & 15) === 0) {
      filter.set(dark + (bright - dark) * level * Math.sqrt(level));
      if (n < glide) frequency *= step;
      const dt = frequency * (1 + vibrato * sin1((4.7 * n / RATE + drift) % 1) * Math.min(1, n / (RATE * .3))) / RATE;
      d0 = dt * low; d1 = dt; d2 = dt * high; d3 = dt * .5;
    }
    p0 += d0; if (p0 >= 1) p0 -= 1;
    p1 += d1; if (p1 >= 1) p1 -= 1;
    p2 += d2; if (p2 >= 1) p2 -= 1;
    p3 += d3; if (p3 >= 1) p3 -= 1;
    const x = sub * sin1(p3) + 2 * (p0 + p1 + p2) - 3 - blep(p0, d0) - blep(p1, d1) - blep(p2, d2);
    out[i] += gain * level * filter.step(x);
  }
}
const chord = (out, rand, notes, options) => { for (const f of notes) horn(out, rand, { ...options, f }); };

// Taiko-like membrane: a fundamental settling in pitch, inharmonic overtones, the skin slap and the air it moves.
function drum(out, rand, { at = 0, f = 70, gain = .5, decay = 6, slap = .35 }) {
  tone(out, { at, f: f * 1.45, to: f, time: .03, decay, gain: gain * .75 });
  modal(out, rand, { at, f, gain: gain * .85, hard: .0015, grit: .3, modes: [[1.59, .55, decay * 2.2], [2.14, .4, decay * 3], [2.65, .28, decay * 3.8], [3.16, .18, decay * 4.6]] });
  noise(out, rand, { at, type: 'low', f: 1100, q: .7, decay: 70, gain: gain * slap });
  noise(out, rand, { at, type: 'low', f: f * 2.4, q: .8, attack: .004, decay: decay * 1.6, gain: gain * .3, color: .6 });
}

// Outdoor slapback baked into a recipe: band-limited, delayed copies of the dry render, as off ridges and
// wrecks nearby. taps: [delay s, gain, centre Hz].
function reflect(out, taps) {
  const dry = out.slice();
  for (const [delay, gain, f] of taps) {
    const filter = new Filter(f, .5), d = Math.round(delay * RATE);
    for (let i = d; i < out.length; i++) { filter.step(dry[i - d]); out[i] += gain * filter.band; }
  }
}
// Debris: small low-passed impacts thinning out over `length` seconds, some landing with a dull thud.
function scatter(out, rand, at, length, count, gain, f = 900) {
  for (let i = 0; i < count; i++) {
    const u = rand() ** 1.7, t = at + u * length, g = gain * (1 - .75 * u) * (.35 + .65 * rand());
    noise(out, rand, { at: t, type: 'band', f: f * (.5 + 1.4 * rand()), q: 1.3, decay: 60 + 80 * rand(), gain: g });
    if (rand() < .4) tone(out, { at: t, f: 80 + 90 * rand(), to: 45, time: .03, decay: 35, gain: g * .9 });
  }
}
// A machine link: band noise keyed on and off by a pseudo-random bit stream; texture, never a tone.
function dataBurst(out, rand, at, length, gain, rate = 900, f = 1700) {
  const start = Math.round(at * RATE), stop = Math.min(out.length, start + Math.round(length * RATE)), bit = Math.max(1, Math.round(RATE / rate));
  const filter = new Filter(f, 2.2), state = rand.state;
  let on = 0, level = 0;
  for (let i = start; i < stop; i++) {
    if ((i - start) % bit === 0) on = nextRandom(state) < .55 ? 1 : 0;
    level += (on - level) * .25;
    filter.step(nextRandom(state) * 2 - 1);
    out[i] += gain * level * filter.band * Math.min(1, (i - start) / 48, (stop - i) / 48);
  }
}

// Shared output stage: optional saturation, DC removal, click-free edges and peak normalization. Saturation
// works on the peak-normalized render, so `drive` means the same squeeze whatever the recipe's raw level.
// Loops keep their wrap point intact: they drop the mean instead of running a DC filter and get no edge fades.
function finish(out, { level = .9, drive = 0, fadeIn = .0015, loop = false }) {
  let previousIn = 0, previousOut = 0, peak = 0, mean = 0;
  if (loop) { for (let i = 0; i < out.length; i++) mean += out[i]; mean /= out.length; }
  if (drive) { for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i])); drive /= peak || 1; peak = 0; }
  const pole = 1 - TAU * 18 / RATE, tail = Math.min(out.length, Math.round(RATE * .012)), head = Math.max(1, Math.round(RATE * fadeIn));
  for (let i = 0; i < out.length; i++) {
    let x = drive ? soft(out[i] * drive) : out[i];
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
function normalize(out, level = 1) {
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= level / peak;
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

// Recipes: bus/category for the mixer, duration in seconds, variants, peak level, playback gain, rate jitter,
// per-group cooldown and how strongly the cue ducks combat and music. render(out, rand, variant) adds into out.
const R = Object.create(null);
const ui = (duration, render, extra = {}) => ({ bus: 'ui', category: 'ui', duration, render, level: .8, ...extra });
const weapon = (duration, render, extra = {}) => ({ bus: 'weapons', category: 'weapon', duration, variants: 3, jitter: .045, cooldown: .05, level: .92, render, ...extra });
const impact = (duration, render, extra = {}) => ({ bus: 'impacts', category: 'impact', duration, variants: 2, jitter: .05, cooldown: .06, level: .92, render, ...extra });
const alert = (duration, render, extra = {}) => ({ bus: 'alerts', category: 'alert', duration, cooldown: .4, duck: .5, level: .82, drive: 1.4, render, ...extra });
// Pitches (Hz) for hums, horns and stingers.
const A1 = 55, D2 = 73.42, E2 = 82.41, F2 = 87.31, G2 = 98, A2 = 110, Bb2 = 116.54, B2 = 123.47, Cs3 = 138.59, D3 = 146.83, Eb3 = 155.56, E3 = 164.81, Fs3 = 185, Ab3 = 207.65;

// Interface feedback: a field console's muffled relays, padded knocks, servos and latches. Pitch is kept to
// brief low hums and the refused order's blat; there are no melodic bleeps.
function relay(out, rand, at, { f = 1150, gain = .14, decay = 240, tick = .08 } = {}) {
  modal(out, rand, { at, f: f * jitter(rand, .03), gain, hard: .0005, grit: .4, modes: [[1, 1, decay], [1.83, .55, decay * 1.3], [2.71, .3, decay * 1.7]] });
  noise(out, rand, { at, type: 'band', f: f * .8, q: 1.2, decay: 500, gain: tick });
}
// A padded knock: a dull low-mid resonance with the slap of its housing.
function knock(out, rand, at, { f = 200, gain = .3, decay = 50 } = {}) {
  modal(out, rand, { at, f, gain, hard: .0022, grit: .15, modes: [[1, 1, decay], [1.58, .45, decay * 1.5], [2.37, .2, decay * 2.2]] });
  noise(out, rand, { at, type: 'band', f: f * 2.5, q: .7, decay: decay * 2.5, gain: gain * .75 });
}
function latch(out, rand, at, { f = 600, gain = .2, decay = 70 } = {}) {
  modal(out, rand, { at, f: f * jitter(rand, .04), gain, hard: .0008, grit: .3, modes: modes(BAR, decay) });
}
function servo(out, rand, at, { from = 380, to = 900, length = .08, gain = .12, q = 4 } = {}) {
  noise(out, rand, { at, type: 'band', f: from, to, time: length, q, attack: length * .3, decay: 2 / length, gain, length });
}
// A low hum swelling briefly: a system coming online.
const hum = (out, rand, at, notes, gain, length = .2) => { for (const [f, g] of notes) horn(out, rand, { at, f, attack: .05, length, release: .25, gain: gain * g, bright: 800, dark: 160, q: 1.2, sub: .3, vibrato: 0 }); };
R.select = ui(.1, (o, r) => { knock(o, r, 0, { f: 210, gain: .45, decay: 50 }); relay(o, r, .003, { f: 1150 }); relay(o, r, .045, { f: 860, gain: .05, tick: .04 }); });
R.order = ui(.2, (o, r) => { knock(o, r, 0, { f: 175, gain: .45, decay: 42 }); relay(o, r, .002, { f: 1000, gain: .12 }); knock(o, r, .062, { f: 140, gain: .32, decay: 45 }); relay(o, r, .064, { f: 760, gain: .08, tick: .06 }); });
// Weapons free: a heavy lever thrown twice, each with a steel latch.
R.attackOrder = ui(.22, (o, r) => {
  for (const [at, f, g] of [[0, 640, 1], [.075, 560, .8]]) {
    latch(o, r, at, { f, gain: .26 * g, decay: 38 }); knock(o, r, at, { f: 130, gain: .32 * g, decay: 40 });
    noise(o, r, { at, type: 'low', f: 700, q: .7, decay: 40, gain: .3 * g });
  }
}, { level: .74, drive: 1.5 });
R.harvestOrder = ui(.26, (o, r) => { servo(o, r, 0, { from: 280, to: 760, length: .11, gain: .28, q: 3.5 }); knock(o, r, .11, { f: 160, gain: .38, decay: 40 }); relay(o, r, .112, { f: 700, gain: .08, tick: .05 }); }, { drive: 1.3 });
R.rally = ui(.42, (o, r) => { knock(o, r, 0, { f: 240, gain: .38, decay: 36 }); relay(o, r, .002, { f: 900, gain: .08 }); reflect(o, [[.11, .32, 600], [.23, .16, 480]]); });
// A refused order: two dull knocks and a short, low tritone blat.
R.error = ui(.24, (o, r) => {
  knock(o, r, 0, { f: 150, gain: .3, decay: 45 }); knock(o, r, .07, { f: 140, gain: .26, decay: 45 });
  for (const f of [92, 130]) horn(o, r, { f, attack: .006, length: .13, release: .05, gain: .14, bright: 650, dark: 200, q: 1.2, detune: .012, vibrato: 0 });
}, { level: .7 });
R.cancel = ui(.15, (o, r) => { relay(o, r, 0, { f: 900, gain: .12 }); servo(o, r, .01, { from: 700, to: 300, length: .08, gain: .28, q: 3 }); knock(o, r, .05, { f: 150, gain: .3, decay: 55 }); }, { level: .6, drive: 2 });
R.group = ui(.11, (o, r) => { knock(o, r, 0, { f: 200, gain: .4, decay: 60 }); relay(o, r, 0, { f: 1050, gain: .12 }); knock(o, r, .032, { f: 230, gain: .26, decay: 60 }); relay(o, r, .032, { f: 1180, gain: .1 }); }, { level: .6, drive: 1.3 });
R.buildStart = ui(.5, (o, r) => {
  knock(o, r, 0, { f: 120, gain: .38, decay: 26 }); tone(o, { f: 95, to: 45, time: .04, decay: 22, gain: .2 });
  modal(o, r, { f: 260, gain: .22, hard: .001, modes: modes(PLATE, 30) });
  noise(o, r, { at: .02, type: 'low', f: 1300, q: .6, attack: .04, decay: 7, gain: .3, color: .3 });
  for (const at of [.13, .18, .23]) relay(o, r, at, { f: 720, gain: .12, tick: .07 });
}, { drive: 1.4 });
R.buildComplete = ui(.65, (o, r) => {
  modal(o, r, { f: 180, gain: .3, hard: .0012, modes: modes(PLATE, 26) }); relay(o, r, 0, { f: 820, gain: .1 });
  hum(o, r, .02, [[E2, 1], [B2, .6]], .3, .22);
});
R.unitReady = ui(.48, (o, r) => {
  latch(o, r, 0, { f: 310, gain: .26, decay: 40 }); knock(o, r, 0, { f: 130, gain: .25, decay: 40 });
  noise(o, r, { at: .03, type: 'band', f: 1700, q: .8, attack: .008, decay: 14, gain: .1 });
  hum(o, r, .05, [[A2, 1], [E3, .55]], .24, .14);
});
R.delivery = ui(.4, (o, r) => {
  tone(o, { at: .015, f: 115, to: 60, time: .03, decay: 22, gain: .18 });
  noise(o, r, { at: .01, type: 'band', f: 1050, q: .8, attack: .02, decay: 9, gain: .32, grain: .45, grainRate: 90 });
  for (let i = 0; i < 4; i++) modal(o, r, { at: .02 + .22 * r(), f: 1250 + 700 * r(), gain: .06, hard: .0003, modes: [[1, 1, 45], [2.32, .5, 70], [4.25, .2, 100]] });
}, { cooldown: .5 });
R.sell = ui(.48, (o, r) => {
  for (let i = 0; i < 5; i++) relay(o, r, i * .052, { f: 1100 - i * 110, gain: .14 - i * .012, tick: .08 });
  servo(o, r, .02, { from: 820, to: 260, length: .26, gain: .3, q: 3 });
  knock(o, r, .3, { f: 125, gain: .26, decay: 32 });
}, { drive: 1.4 });
R.repair = ui(.45, (o, r) => {
  noise(o, r, { type: 'band', f: 1300, q: 1.1, decay: 5, gain: .3, grain: .45, grainRate: 180 });
  tone(o, { f: 100, decay: 6, gain: .08 }); tone(o, { f: 200, decay: 8, gain: .035 });
  relay(o, r, .26, { f: 900, gain: .09, tick: .05 });
}, { level: .65, drive: 1.6 });

// Organics weapons: obsolete powder arms. A sharp crack, the gas body, a chest thump and a gritty tail; bolts
// and breeches ring through damped steel modes; ridges throw the report back.
function powder(out, rand, at, { crack = 2600, body = 850, low = 120, size = 1, grit = .1 }) {
  noise(out, rand, { at, type: 'high', f: crack * jitter(rand, .08), q: .6, decay: 300 / size, gain: .85 });
  noise(out, rand, { at, type: 'band', f: crack * .55, q: .8, decay: 120 / size, gain: .45 });
  noise(out, rand, { at, type: 'low', f: body * jitter(rand, .1), to: body * .3, time: .05 * size, q: .9, decay: 28 / size, gain: .9, color: .3 });
  tone(out, { at, f: low * 1.8 * jitter(rand, .05), to: low * .45, time: .05 * size, decay: 24 / size, gain: .4 });
  noise(out, rand, { at: at + .012, type: 'low', f: 1300, q: .7, attack: .01, decay: 11 / size, gain: grit, grain: .5, grainRate: 140, color: .2 });
}
// Steel parts slamming home: a short clack and damped, inharmonic bar modes.
function clank(out, rand, at, { f = 1500, gain = .1, decay = 75 } = {}) {
  modal(out, rand, { at, f: f * jitter(rand, .06), gain, hard: .0003, grit: .4, modes: modes(BAR, decay) });
  noise(out, rand, { at, type: 'band', f: f * 1.2, q: 1.2, decay: 400, gain: gain * .8 });
}
// A rocket motor lighting: ignition pop, a launch thump, then a crackling, receding roar.
function launch(out, rand, at, { thump = 110, gain = .5 } = {}) {
  noise(out, rand, { at, type: 'band', f: 900, q: .8, decay: 70, gain: .6 });
  tone(out, { at, f: thump * 1.4, to: thump * .45, time: .06, decay: 22, gain: .45 });
  noise(out, rand, { at: at + .01, type: 'band', f: 420, to: 1500, time: .4, q: 1.1, attack: .04, decay: 3.2, gain, length: .55, grain: .65, grainRate: 200 });
  noise(out, rand, { at: at + .01, type: 'low', f: 260, q: .8, attack: .03, decay: 4.5, gain: gain * .7, color: .7 });
}
R['organics.rifle'] = weapon(.5, (o, r) => {
  for (let i = 0; i < 3; i++) powder(o, r, i * .075 + (r() - .5) * .012, {});
  clank(o, r, .26 + .02 * r(), { f: 1350, gain: .09 });
  reflect(o, [[.085, .24, 950], [.17, .13, 700]]);
}, { cooldown: .06 });
R['organics.scout'] = weapon(.42, (o, r) => {
  for (let i = 0; i < 4; i++) powder(o, r, i * .056 + (r() - .5) * .008, { crack: 3100, body: 1150, low: 170, size: .8 });
  reflect(o, [[.07, .2, 1100], [.14, .1, 800]]);
}, { level: .82 });
R['organics.striker'] = weapon(.5, (o, r) => {
  for (let i = 0; i < 2; i++) { powder(o, r, i * .095, { crack: 2100, body: 650, low: 100, size: 1.35, grit: .14 }); clank(o, r, i * .095 + .06, { f: 900, gain: .07 }); }
  reflect(o, [[.1, .26, 850], [.2, .14, 650]]);
});
R['organics.tank'] = weapon(1.1, (o, r) => {
  powder(o, r, 0, { crack: 1900, body: 560, low: 75, size: 2.2, grit: .18 });
  noise(o, r, { type: 'low', f: 380, to: 90, time: .2, q: .8, decay: 5, gain: .55, color: .6 });
  tone(o, { f: 70, to: 30, time: .18, decay: 6, gain: .5 });
  modal(o, r, { at: .004, f: 205 * jitter(r, .04), gain: .05, hard: .001, modes: modes(SHELL, 7) });
  clank(o, r, .4 + .05 * r(), { f: 620, gain: .08, decay: 40 });
  reflect(o, [[.12, .3, 850], [.26, .18, 600], [.42, .08, 450]]);
}, { variants: 2, drive: 2.2, cooldown: .12 });
R['organics.artillery'] = weapon(1.4, (o, r) => {
  powder(o, r, 0, { crack: 1600, body: 450, low: 60, size: 2.8, grit: .2 });
  noise(o, r, { type: 'low', f: 300, to: 70, time: .3, q: .8, decay: 3.2, gain: .65, color: .7 });
  tone(o, { f: 58, to: 24, time: .25, decay: 4.5, gain: .55 });
  noise(o, r, { at: .06, type: 'low', f: 160, q: .7, attack: .1, decay: 2.2, gain: .35, color: .9 });
  clank(o, r, .55 + .05 * r(), { f: 480, gain: .07, decay: 34 });
  reflect(o, [[.15, .32, 750], [.32, .2, 550], [.55, .1, 420]]);
}, { variants: 2, drive: 2.2, cooldown: .2 });
R['organics.rocket'] = weapon(.8, (o, r) => { launch(o, r, 0); reflect(o, [[.1, .2, 800]]); }, { variants: 2, cooldown: .12 });
R['organics.rocketTower'] = weapon(1, (o, r) => { launch(o, r, 0, { thump: 95 }); launch(o, r, .19, { thump: 90, gain: .42 }); reflect(o, [[.11, .2, 750]]); }, { variants: 2, cooldown: .16 });
R['organics.turret'] = weapon(.6, (o, r) => {
  powder(o, r, 0, { crack: 2200, body: 600, low: 95, size: 1.6, grit: .16 });
  clank(o, r, .1 + .02 * r(), { f: 760, gain: .12, decay: 50 });
  reflect(o, [[.1, .26, 850], [.21, .14, 650]]);
}, { drive: 1.5, cooldown: .12 });

// AI Unity weapons: magnetic and plasma arms. Rail cracks ring metallically over a low thump, plasma bursts
// sweep through resonant bands, arcs crackle and heavy guns hum as they charge. There is no powder body, so
// the races never share a timbre.
function rail(out, rand, at, { ring = 2400, size = 1, thump = 95, snap = .3, gain = 1 }) {
  noise(out, rand, { at, type: 'high', f: 3400, q: .7, decay: 500 / size, gain: .9 * gain });
  noise(out, rand, { at, type: 'band', f: 1000, q: .8, decay: 70 / size, gain: .45 * gain });
  modal(out, rand, { at, f: ring * jitter(rand, .04), gain: .26 * gain, hard: .0002, grit: .2, modes: modes(SHELL, 55 / size) });
  tone(out, { at, f: thump * 1.7, to: thump * .4, time: .045 * size, decay: 26 / size, gain: .32 * gain });
  noise(out, rand, { at, type: 'band', f: 2700, q: 1.3, decay: 45 / size, gain: snap * gain, grain: .4, grainRate: 900 });
  noise(out, rand, { at: at + .004, type: 'band', f: 2600, to: 650, time: .1 * size, q: 3.5, decay: 20 / size, gain: .2 * gain });
}
function plasma(out, rand, at, { f = 1400, to = 900, size = 1, thump = 90, gain = 1 }) {
  noise(out, rand, { at, type: 'band', f: f * jitter(rand, .05), to, time: .07 * size, q: 6, attack: .004, decay: 22 / size, gain: .8 * gain });
  noise(out, rand, { at, type: 'band', f: f * .45, to: to * .5, time: .08 * size, q: 4, attack: .004, decay: 20 / size, gain: .5 * gain });
  noise(out, rand, { at, type: 'band', f: 3000, q: 1.2, decay: 40 / size, gain: .25 * gain, grain: .4, grainRate: 700 });
  tone(out, { at, f: thump * 1.6, to: thump * .45, time: .05 * size, decay: 24 / size, gain: .28 * gain });
}
function arc(out, rand, at, { f = 2300, length = .05, gain = .5 }) {
  noise(out, rand, { at, type: 'band', f, q: 1.2, attack: .002, decay: 20, length, gain, grain: .35, grainRate: 800 });
  noise(out, rand, { at, type: 'band', f: f * .5, to: f * .35, time: length, q: 5, decay: 30, gain: gain * .4 });
  tone(out, { at, f: 140, to: 70, time: .03, decay: 40, gain: gain * .35 });
}
// A deep charge: a resonant saw hum climbing in pitch, leading a heavy gun's shot.
function charge(out, rand, at, { length = .05, f = 45, bend = 2, gain = .3 }) {
  horn(out, rand, { at, f, bend, time: length, attack: length * .9, length, release: .03, gain, bright: 900, dark: 140, q: 2.6, detune: .012, sub: .4, vibrato: 0 });
}
function magLaunch(out, rand, at, { gain = .5 } = {}) {
  tone(out, { at, f: 120, to: 45, time: .06, decay: 22, gain: .35 });
  noise(out, rand, { at, type: 'band', f: 2800, q: 1.3, decay: 60, gain: .4, grain: .4, grainRate: 900 });
  noise(out, rand, { at: at + .01, type: 'band', f: 380, to: 2100, time: .3, q: 4.5, attack: .03, decay: 4, gain, length: .5 });
  noise(out, rand, { at: at + .01, type: 'band', f: 800, to: 1400, time: .3, q: 1, attack: .02, decay: 5, gain: gain * .5, grain: .5, grainRate: 300 });
}
R['aiUnity.rifle'] = weapon(.42, (o, r) => {
  rail(o, r, 0, { ring: 2000, size: .7, thump: 120 }); rail(o, r, .1 + (r() - .5) * .01, { ring: 1950, size: .7, thump: 115, gain: .85 });
  reflect(o, [[.075, .16, 1300], [.15, .08, 900]]);
}, { drive: 1.4, cooldown: .06 });
R['aiUnity.scout'] = weapon(.4, (o, r) => {
  for (let i = 0; i < 3; i++) arc(o, r, i * .06, { f: 2100 + 400 * r(), length: .045, gain: .55 });
  reflect(o, [[.07, .16, 1200]]);
}, { level: .82, drive: 1.4 });
R['aiUnity.striker'] = weapon(.48, (o, r) => {
  for (let i = 0; i < 2; i++) plasma(o, r, i * .085, { f: 1500, to: 850, thump: 85 });
  reflect(o, [[.09, .2, 1000], [.18, .1, 700]]);
}, { drive: 1.4 });
R['aiUnity.tank'] = weapon(1, (o, r) => {
  charge(o, r, 0, { length: .05, f: 45, bend: 2.1, gain: .3 });
  rail(o, r, .04, { ring: 1150, size: 1.9, thump: 70, snap: .35 });
  tone(o, { at: .04, f: 62, to: 26, time: .2, decay: 6, gain: .35 });
  noise(o, r, { at: .05, type: 'low', f: 700, to: 140, time: .18, q: .8, decay: 6, gain: .4, color: .5 });
  noise(o, r, { at: .08, type: 'band', f: 1900, q: 1.1, decay: 7, gain: .12, grain: .4, grainRate: 450 });
  reflect(o, [[.12, .26, 900], [.27, .14, 650]]);
}, { variants: 2, drive: 1.9, cooldown: .12 });
R['aiUnity.artillery'] = weapon(1.45, (o, r) => {
  charge(o, r, 0, { length: .26, f: 32, bend: 2, gain: .3 });
  noise(o, r, { type: 'band', f: 1600, q: 1.3, attack: .26, curve: 2, decay: 40, gain: .2, grain: .4, grainRate: 500, length: .27 });
  rail(o, r, .27, { ring: 820, size: 2.4, thump: 55, snap: .4 });
  tone(o, { at: .27, f: 52, to: 22, time: .28, decay: 4.2, gain: .4 });
  noise(o, r, { at: .28, type: 'low', f: 520, to: 100, time: .25, q: .8, decay: 3.5, gain: .5, color: .6 });
  noise(o, r, { at: .3, type: 'band', f: 1500, q: 1, decay: 4, gain: .12, grain: .4, grainRate: 300 });
  reflect(o, [[.15, .3, 800], [.33, .18, 560], [.55, .09, 420]]);
}, { variants: 2, drive: 1.9, cooldown: .2 });
R['aiUnity.rocket'] = weapon(.75, (o, r) => { magLaunch(o, r, 0); reflect(o, [[.1, .18, 900]]); }, { variants: 2, cooldown: .12 });
R['aiUnity.turret'] = weapon(.6, (o, r) => { rail(o, r, 0, { ring: 1500, size: 1.25, thump: 85, snap: .35 }); reflect(o, [[.1, .24, 1000], [.21, .12, 700]]); }, { drive: 1.5, cooldown: .12 });
R['aiUnity.rocketTower'] = weapon(.95, (o, r) => { magLaunch(o, r, 0); magLaunch(o, r, .17, { gain: .42 }); reflect(o, [[.11, .18, 850]]); }, { variants: 2, cooldown: .16 });

// Impacts and deaths, sized by what was hit: a crack, a falling gas body, a sub drop, low-passed debris and a
// settling rumble.
function blast(out, rand, at, { size = 1, crack = 1600, body = 520, sub = 70, metal = 0, debris = .2, rumble = .3 }) {
  noise(out, rand, { at, type: 'high', f: crack, q: .6, decay: 110 / size, gain: .75 });
  noise(out, rand, { at, type: 'low', f: body, to: body * .2, time: .12 * size, q: .8, decay: 5 / size, gain: 1, color: .6 });
  tone(out, { at, f: sub * 1.6, to: sub * .4, time: .16 * size, decay: 6.5 / size, gain: .5 });
  if (metal) modal(out, rand, { at: at + .008, f: 170 * metal, gain: .1, hard: .002, grit: .3, modes: modes(SHELL, 6) });
  if (debris) scatter(out, rand, at + .05 * size, .9 * size, Math.round(12 * size), debris);
  if (rumble) noise(out, rand, { at: at + .02, type: 'low', f: 130, q: .7, attack: .1 * size, decay: 2 / size, gain: rumble, color: .9 });
}
R['impact.rocket'] = impact(1.1, (o, r) => { blast(o, r, 0, { size: .8, crack: 2000, body: 600, sub: 80, debris: .25, rumble: .25 }); reflect(o, [[.12, .2, 800]]); }, { drive: 1.9 });
R['impact.rocketHeavy'] = impact(1.4, (o, r) => { blast(o, r, 0, { size: 1.15, crack: 1700, body: 520, sub: 70, debris: .3, rumble: .3 }); reflect(o, [[.13, .22, 750], [.28, .1, 550]]); }, { drive: 1.9 });
R['impact.shell'] = impact(1.8, (o, r) => { blast(o, r, 0, { size: 1.5, crack: 1500, body: 460, sub: 52, debris: .3, rumble: .5 }); reflect(o, [[.15, .25, 700], [.33, .12, 500]]); }, { drive: 2.2, cooldown: .08 });
// An incoming shell: a falling, tearing shriek and a rush of air that swell until it lands.
R['impact.whistle'] = impact(.45, (o, r) => {
  noise(o, r, { type: 'band', f: 1500, to: 540, time: .44, q: 9, attack: .32, curve: 2, decay: 1.5, gain: 1 });
  noise(o, r, { type: 'band', f: 1100, to: 500, time: .44, q: 2, attack: .38, curve: 2.4, decay: 1, gain: .35 });
  noise(o, r, { type: 'low', f: 220, q: .7, attack: .4, curve: 3, decay: 1, gain: .12, color: .8 });
}, { variants: 1, cooldown: .15, level: .7, drive: 1.8 });
R['death.infantry'] = impact(.6, (o, r) => {
  tone(o, { f: 120, to: 55, time: .05, decay: 20, gain: .32 }); noise(o, r, { type: 'low', f: 600, q: .7, decay: 22, gain: .45, color: .4 });
  const kit = .1 + .03 * r();
  tone(o, { at: kit, f: 95, to: 50, time: .04, decay: 28, gain: .22 }); noise(o, r, { at: kit, type: 'low', f: 500, q: .7, decay: 30, gain: .25, color: .4 });
  for (let i = 0; i < 3; i++) clank(o, r, .03 + .2 * r(), { f: 1300 + 900 * r(), gain: .05, decay: 70 });
  noise(o, r, { at: .03, type: 'band', f: 900, q: .7, attack: .02, decay: 10, gain: .22, grain: .5, grainRate: 70 });
}, { level: .78, drive: 1.3 });
// A machine dies: a short-circuit pop, sparks, a servo winding down and the frame clattering to the ground.
R['death.robot'] = impact(.8, (o, r) => {
  noise(o, r, { type: 'band', f: 2300, q: 1, decay: 90, gain: .5 }); tone(o, { f: 140, to: 60, time: .05, decay: 25, gain: .25 });
  noise(o, r, { at: .01, type: 'band', f: 2800, q: 1.4, decay: 6, gain: .3, grain: .35, grainRate: 500 });
  noise(o, r, { at: .02, type: 'band', f: 900, to: 180, time: .45, q: 8, attack: .01, decay: 4, gain: .45 });
  for (let i = 0; i < 3; i++) modal(o, r, { at: .12 + i * .09 + .04 * r(), f: 420 + 380 * r(), gain: .1, hard: .0006, modes: modes(SHELL, 22) });
  const down = .3 + .05 * r();
  tone(o, { at: down, f: 100, to: 48, time: .05, decay: 18, gain: .22 }); noise(o, r, { at: down, type: 'low', f: 500, q: .7, decay: 25, gain: .2, color: .4 });
}, { level: .8, drive: 1.3 });
R['death.vehicle'] = impact(1.4, (o, r) => {
  blast(o, r, 0, { size: 1.1, metal: jitter(r, .06), debris: .22, rumble: .35 });
  noise(o, r, { at: .1, type: 'band', f: 1100, q: .8, attack: .1, decay: 2.5, gain: .07, grain: .5, grainRate: 50 });
  reflect(o, [[.13, .22, 750], [.28, .1, 550]]);
}, { drive: 2.1 });
R['death.small'] = impact(1.4, (o, r) => {
  blast(o, r, 0, { size: .9, crack: 1300, body: 380, sub: 62, debris: .32, rumble: .3 });
  scatter(o, r, .15, .9, 14, .25, 500);
  reflect(o, [[.12, .2, 700]]);
}, { variants: 1, drive: 2.1 });
// A building comes down: the blast, a long swelling roar of collapse, girders groaning, floors pancaking,
// debris raining down and grit trickling as it settles.
R['death.building'] = impact(3.6, (o, r) => {
  blast(o, r, 0, { size: 1.6, crack: 1200, body: 380, sub: 50, metal: .7, debris: .15, rumble: 0 });
  noise(o, r, { at: .05, type: 'low', f: 170, q: .7, attack: .5, decay: .85, gain: .9, color: .9 });
  noise(o, r, { at: .1, type: 'low', f: 70, q: .7, attack: .7, decay: .7, gain: .7, color: .95 });
  noise(o, r, { at: .3, type: 'band', f: 260, to: 170, time: 1.2, q: 12, attack: .2, decay: 1.6, gain: .12 });
  for (const [at, size] of [[.9 + .2 * r(), 1], [1.5 + .2 * r(), .8], [2.2 + .2 * r(), .6]]) {
    tone(o, { at, f: 70, to: 30, time: .12, decay: 6, gain: .45 * size });
    noise(o, r, { at, type: 'low', f: 450, to: 150, time: .15, q: .8, decay: 7, gain: .5 * size, color: .5 });
  }
  scatter(o, r, .15, 3, 46, .2, 520);
  noise(o, r, { at: 1.6, type: 'band', f: 1200, q: .8, attack: .3, decay: 1.6, gain: .05, grain: .3, grainRate: 80 });
  reflect(o, [[.18, .25, 600]]);
}, { variants: 1, drive: 2, cooldown: .25 });

// Alert stingers: centred, never dropped, each with its own cooldown. Low brass, drums and filtered horns in
// dark harmony (open fifths, suspensions, tritones and clusters), never bright arpeggios or bleeps. The brass
// filter resonates as it opens, so a low section still carries on small speakers.
const BRASS = { q: 1.5, bright: 1600, dark: 220 };
R['alert.underAttack'] = alert(1.05, (o, r) => {
  drum(o, r, { f: 62, gain: .4, decay: 7 });
  for (const [at, f] of [[0, Eb3], [.38, D3]]) chord(o, r, [f, f * Math.SQRT2], { ...BRASS, at, attack: .03, length: .3, release: .14, gain: .14, bright: 2000, dark: 280, bend: .985, vibrato: 0 });
}, { cooldown: 5, duck: .65, drive: 2.2 });
// Every friendly loss is an event: a sparse, lightly ducking cue keeps a long fight from pumping the mix.
R['alert.unitLost'] = alert(.85, (o, r) => {
  noise(o, r, { type: 'band', f: 1500, q: .7, decay: 14, gain: .2, grain: .55, grainRate: 120, length: .18 });
  drum(o, r, { at: .03, f: 70, gain: .25, decay: 9, slap: .2 });
  chord(o, r, [E3, B2], { ...BRASS, at: .05, attack: .08, length: .3, release: .35, gain: .12, bright: 1100, bend: .944 });
}, { cooldown: 6, duck: .2 });
R['alert.structureLost'] = alert(1.3, (o, r) => {
  drum(o, r, { f: 55, gain: .45, decay: 5 });
  chord(o, r, [A2, D3, Eb3], { ...BRASS, at: .02, attack: .1, length: .5, release: .55, gain: .12, bright: 1300, bend: .95 });
  noise(o, r, { at: .1, type: 'low', f: 140, q: .7, attack: .2, decay: 2.2, gain: .25, color: .9 });
}, { cooldown: 2.5, duck: .55, drive: 1.6 });
R['alert.research'] = alert(1.1, (o, r) => { relay(o, r, 0, { f: 900, gain: .1, tick: .06 }); chord(o, r, [D2, A2, E3], { ...BRASS, attack: .25, length: .45, release: .4, gain: .11, bright: 1400 }); }, { duck: .35, drive: 1.5 });
R['alert.upgrade'] = alert(.9, (o, r) => {
  modal(o, r, { f: 170, gain: .3, hard: .001, modes: modes(PLATE, 28) }); knock(o, r, 0, { f: 120, gain: .3, decay: 35 });
  chord(o, r, [A2, E3], { ...BRASS, at: .04, attack: .06, length: .3, release: .35, gain: .12, bright: 1400 });
}, { duck: .35 });
R['alert.promotion'] = alert(1.1, (o, r) => {
  chord(o, r, [E2, B2], { ...BRASS, attack: .08, length: .28, release: .3, gain: .12, bright: 1200 });
  chord(o, r, [A2, E3], { ...BRASS, at: .32, attack: .1, length: .4, release: .4, gain: .12 });
  drum(o, r, { at: .32, f: 82, gain: .3, decay: 8 });
}, { duck: .35 });
// Power loss: a breaker trips and the generators spin down to a last thump; recovery spins them back up.
R['alert.powerDown'] = alert(1.25, (o, r) => {
  modal(o, r, { f: 160, gain: .3, hard: .001, modes: modes(PLATE, 25) }); relay(o, r, 0, { f: 800, gain: .12 });
  horn(o, r, { f: 110, bend: .25, time: 1, attack: .01, length: .95, release: .2, gain: .22, bright: 1300, dark: 110, q: 1.5, detune: .01, sub: .3, vibrato: 0 });
  noise(o, r, { type: 'low', f: 900, to: 150, time: .9, q: 1, attack: .02, decay: 2.5, gain: .1 });
  drum(o, r, { at: .95, f: 48, gain: .3, decay: 8, slap: .2 });
}, { cooldown: 3, duck: .5, drive: 1.6 });
R['alert.powerUp'] = alert(1.05, (o, r) => {
  modal(o, r, { f: 190, gain: .26, hard: .001, modes: modes(PLATE, 28) }); relay(o, r, 0, { f: 850, gain: .12 });
  horn(o, r, { at: .03, f: 40, bend: 2.75, time: .7, attack: .5, length: .75, release: .25, gain: .2, bright: 1400, dark: 130, q: 1.5, detune: .01, sub: .3, vibrato: 0 });
  noise(o, r, { at: .03, type: 'low', f: 200, to: 900, time: .7, q: 1, attack: .5, decay: 2, gain: .08 });
}, { cooldown: 3, duck: .35, drive: 1.6 });
R['alert.reserve'] = alert(.75, (o, r) => {
  for (const at of [0, .3]) { relay(o, r, at, { f: 700, gain: .08, tick: .05 }); chord(o, r, [G2, Cs3], { ...BRASS, at: at + .01, attack: .04, length: .15, release: .16, gain: .13, bright: 1500, vibrato: 0 }); }
}, { cooldown: 3, duck: .35, drive: 1.8 });
// An objective held: a suspended low swell resolving to its open fifth over a drum.
R['alert.objective'] = alert(1.5, (o, r) => {
  drum(o, r, { f: D2, gain: .16, decay: 6 });
  chord(o, r, [D2, A2, E3], { ...BRASS, attack: .2, length: .35, release: .3, gain: .1, bright: 1300 });
  chord(o, r, [D2, A2, D3], { ...BRASS, at: .45, attack: .12, length: .45, release: .5, gain: .11 });
  drum(o, r, { at: .45, f: D2, gain: .36, decay: 5 });
}, { duck: .55, drive: 1.6 });
R['alert.objectiveNew'] = alert(.9, (o, r) => {
  relay(o, r, 0, { f: 950, gain: .1, tick: .07 }); drum(o, r, { at: .01, f: E2, gain: .2, decay: 8 });
  chord(o, r, [A2, E3], { ...BRASS, at: .02, attack: .15, length: .32, release: .35, gain: .12, bright: 1400 });
}, { duck: .45 });
R['alert.objectiveFailed'] = alert(1.4, (o, r) => {
  drum(o, r, { f: 52, gain: .4, decay: 5 });
  chord(o, r, [A2, Bb2, Eb3], { ...BRASS, attack: .1, length: .55, release: .6, gain: .1, bright: 1200, dark: 150, bend: .93 });
  noise(o, r, { at: .2, type: 'low', f: 130, q: .7, attack: .3, decay: 2, gain: .25, color: .9 });
}, { duck: .6, drive: 1.6 });
R['alert.wave'] = alert(1.7, (o, r) => {
  drum(o, r, { f: 58, gain: .4, decay: 5 }); drum(o, r, { at: .42, f: 55, gain: .5, decay: 4 });
  chord(o, r, [D2, A2, D3], { ...BRASS, attack: .3, length: .9, release: .4, gain: .12, bright: 1400 });
  horn(o, r, { ...BRASS, f: Eb3, attack: .4, length: .8, release: .4, gain: .05, bright: 1100 });
  noise(o, r, { at: .4, type: 'low', f: 140, q: .7, attack: .2, decay: 2, gain: .25, color: .9 });
}, { cooldown: 4, duck: .65, drive: 1.6 });
// Contact: a radio tick, a muffled drum and a sonar-like ping, a struck hull beating against itself, that
// returns off the ridges.
R['alert.enemySpotted'] = alert(.85, (o, r) => {
  relay(o, r, 0, { f: 1000, gain: .1, tick: .07 });
  drum(o, r, { at: .01, f: 92, gain: .15, decay: 12, slap: .3 });
  modal(o, r, { at: .01, f: 470, gain: .3, hard: .0006, modes: [[1, 1, 7], [1.018, .8, 8], [2.13, .25, 16], [2.9, .1, 22]] });
  noise(o, r, { at: .01, type: 'band', f: 470, q: 5, attack: .004, decay: 12, gain: .2 });
  reflect(o, [[.18, .35, 470]]);
}, { cooldown: 3, duck: .45 });
R['alert.warning'] = alert(.55, (o, r) => {
  for (const at of [0, .19]) chord(o, r, [D3, Ab3], { ...BRASS, at, attack: .02, length: .09, release: .08, gain: .14, vibrato: 0 });
}, { cooldown: 2, duck: .35, drive: 1.8 });
R['alert.explored'] = alert(.65, (o, r) => {
  relay(o, r, 0, { f: 900, gain: .07, tick: .05 });
  chord(o, r, [A2, E3], { ...BRASS, at: .02, attack: .12, length: .15, release: .3, gain: .1, bright: 1000 });
}, { cooldown: 2, duck: .2, level: .6 });

// Abilities, one per role and race. Organics are hand-worked, powder and engine; Unity is servo, charge and
// data, never melodic.
const ability = (render, duration = .62, extra = {}) => ({ bus: 'ui', category: 'alert', duration, render, cooldown: .25, duck: .25, level: .8, ...extra });
R['organics.digIn'] = ability((o, r) => {
  for (let i = 0; i < 3; i++) {
    const at = i * .13 + .02 * r();
    tone(o, { at, f: 95, to: 50, time: .04, decay: 26, gain: .24 });
    noise(o, r, { at, type: 'low', f: 650, q: .7, decay: 22, gain: .5, color: .4, grain: .5, grainRate: 120 });
    noise(o, r, { at: at + .01, type: 'band', f: 1500, q: 1, decay: 35, gain: .22, grain: .5, grainRate: 200 });
  }
}, .62, { drive: 1.3 });
R['aiUnity.digIn'] = ability((o, r) => {
  servo(o, r, 0, { from: 260, to: 620, length: .14, gain: .3, q: 4 });
  for (const at of [.15, .23]) { modal(o, r, { at, f: 150, gain: .3, hard: .0012, modes: modes(PLATE, 30) }); tone(o, { at, f: 110, to: 55, time: .03, decay: 30, gain: .2 }); }
  horn(o, r, { at: .25, f: A2, attack: .05, length: .15, release: .2, gain: .14, bright: 800, dark: 140, q: 1.4, vibrato: 0 });
});
// A rifle bolt worked by hand: lift, draw, push, lock.
R['organics.longShot'] = ability((o, r) => {
  clank(o, r, 0, { f: 1150, gain: .18, decay: 60 });
  noise(o, r, { at: .05, type: 'band', f: 1400, to: 900, time: .07, q: 1.5, attack: .01, decay: 25, gain: .16, length: .08 });
  noise(o, r, { at: .16, type: 'band', f: 900, to: 1300, time: .06, q: 1.5, attack: .01, decay: 25, gain: .15, length: .07 });
  clank(o, r, .24, { f: 980, gain: .22, decay: 55 }); knock(o, r, .24, { f: 170, gain: .25, decay: 50 });
}, .5, { drive: 1.5 });
// Targeting optics: a servo focusing, a burst of data and the lock.
R['aiUnity.longShot'] = ability((o, r) => {
  servo(o, r, 0, { from: 480, to: 1100, length: .16, gain: .28, q: 8 }); dataBurst(o, r, .17, .1, .18, 700, 1400);
  knock(o, r, .3, { f: 190, gain: .36, decay: 55 }); relay(o, r, .3, { f: 760, gain: .08 });
}, .5, { drive: 1.5 });
R['organics.flare'] = ability((o, r) => {
  noise(o, r, { type: 'band', f: 900, q: .8, decay: 60, gain: .5 }); tone(o, { f: 160, to: 70, time: .04, decay: 30, gain: .22 });
  noise(o, r, { at: .03, type: 'band', f: 1600, to: 1000, time: .6, q: 1.1, attack: .06, decay: 2.4, gain: .32, length: .72, grain: .6, grainRate: 220 });
}, .8, { drive: 1.3 });
// A sensor probe is ejected and sounds the ground: its ping is resonant noise, not a tone.
R['aiUnity.flare'] = ability((o, r) => {
  tone(o, { f: 120, to: 50, time: .05, decay: 22, gain: .2 }); noise(o, r, { type: 'band', f: 2600, q: 1.3, decay: 70, gain: .3, grain: .4, grainRate: 900 });
  noise(o, r, { at: .08, type: 'band', f: 480, q: 18, attack: .004, decay: 4.5, gain: .9 }); noise(o, r, { at: .08, type: 'band', f: 240, q: 10, attack: .004, decay: 6, gain: .3 });
  dataBurst(o, r, .3, .18, .18, 600, 1300);
}, .8, { drive: 1.5 });
// An engine pushed past its governor: firing strokes quicken under a rising roar.
R['organics.overdrive'] = ability((o, r) => {
  for (let at = 0; at < .62; at += 1 / (14 + 42 * at)) { tone(o, { at, f: 70, to: 40, time: .02, decay: 30, gain: .3 }); noise(o, r, { at, type: 'low', f: 500, q: .8, decay: 40, gain: .22, color: .3 }); }
  noise(o, r, { type: 'low', f: 220, to: 600, time: .6, q: .9, attack: .1, decay: 2.5, gain: .35, color: .6 });
}, .72);
R['aiUnity.overdrive'] = ability((o, r) => {
  horn(o, r, { f: 42, bend: 2.1, attack: .12, length: .5, release: .15, gain: .26, bright: 900, dark: 140, q: 2.4, detune: .01, sub: .6, vibrato: 0 });
  noise(o, r, { type: 'band', f: 1800, q: 1.2, attack: .4, curve: 2, decay: 8, gain: .14, grain: .4, grainRate: 600 });
}, .72);
R['organics.afterburner'] = ability((o, r) => {
  noise(o, r, { type: 'band', f: 300, to: 1400, time: .3, q: 1, attack: .05, decay: 2.8, gain: .45 }); noise(o, r, { type: 'low', f: 170, q: .7, attack: .05, decay: 3, gain: .4, color: .8 });
  noise(o, r, { at: .05, type: 'band', f: 1100, q: .8, decay: 4, gain: .08, grain: .6, grainRate: 150 });
});
R['aiUnity.afterburner'] = ability((o, r) => {
  noise(o, r, { type: 'band', f: 380, to: 1500, time: .32, q: 5, attack: .04, decay: 3, gain: .4 });
  horn(o, r, { f: 70, bend: 2, attack: .05, length: .4, release: .15, gain: .2, bright: 1000, dark: 140, q: 2, detune: .012, vibrato: 0 });
  noise(o, r, { at: .02, type: 'band', f: 2400, q: 1.3, decay: 7, gain: .1, grain: .4, grainRate: 700 });
});
// A field telephone cranked, and the battery answering far off.
R['organics.barrage'] = ability((o, r) => {
  for (let i = 0; i < 4; i++) relay(o, r, i * .035, { f: 820, gain: .15, tick: .08 });
  for (const at of [.2, .36]) { tone(o, { at, f: 70, to: 35, time: .08, decay: 9, gain: .2 }); noise(o, r, { at, type: 'low', f: 300, q: .7, decay: 9, gain: .45, color: .7 }); }
}, .55, { drive: 1.5 });
R['aiUnity.barrage'] = ability((o, r) => {
  charge(o, r, 0, { length: .2, f: 55, bend: 1.5, gain: .3 }); dataBurst(o, r, .03, .16, .22, 900, 2000);
  tone(o, { at: .24, f: 100, to: 42, time: .05, decay: 18, gain: .25 }); noise(o, r, { at: .24, type: 'low', f: 420, q: .7, decay: 14, gain: .35, color: .5 });
}, .55, { drive: 1.5 });
R['organics.fieldPatch'] = ability((o, r) => {
  noise(o, r, { type: 'band', f: 1600, q: 1.1, decay: 4, gain: .3, grain: .5, grainRate: 160 }); tone(o, { f: 100, decay: 5, gain: .06 });
  for (const at of [.32, .38, .44]) relay(o, r, at, { f: 950, gain: .1, tick: .06 });
});
// A repair swarm: a shimmer of keyed noise over a low hum.
R['aiUnity.fieldPatch'] = ability((o, r) => {
  dataBurst(o, r, 0, .5, .14, 1400, 2600);
  horn(o, r, { f: 82, attack: .1, length: .3, release: .2, gain: .12, bright: 500, dark: 150, q: 1.2, sub: .4, vibrato: .01 });
  servo(o, r, .05, { from: 600, to: 950, length: .2, gain: .06, q: 5 });
});

// Victory and defeat: longer stingers that play over the fading soundtrack. Victory is a slow suspension in
// the low brass resolving over a drum; defeat is a sinking cluster that dissolves into rumble.
R.victory = {
  bus: 'alerts', category: 'alert', duration: 4.2, level: .85, duck: .6, drive: 1.5, render(o, r) {
    drum(o, r, { f: A1, gain: .22, decay: 4 });
    chord(o, r, [D2, G2, A2, D3], { ...BRASS, attack: .55, length: 1.05, release: .45, gain: .09, bright: 1200, dark: 170 });
    drum(o, r, { at: 1.3, f: A1, gain: .5, decay: 2.6 }); tone(o, { at: 1.3, f: 36.7, decay: 1.4, gain: .22 });
    chord(o, r, [D2, A2, D3], { ...BRASS, at: 1.05, attack: .4, length: 1.85, release: 1, gain: .1, bright: 1500 });
    horn(o, r, { ...BRASS, at: 1.25, f: Fs3, attack: .45, length: 1.6, release: 1, gain: .04, bright: 1200 });
  },
};
R.defeat = {
  bus: 'alerts', category: 'alert', duration: 4.2, level: .85, duck: .6, drive: 1.5, render(o, r) {
    drum(o, r, { f: 50, gain: .3, decay: 3 });
    chord(o, r, [E2, F2, Bb2], { ...BRASS, attack: .6, length: 1.8, release: 1.1, gain: .1, bright: 1100, dark: 110, bend: .9, vibrato: .002 });
    horn(o, r, { f: A1, attack: .8, length: 2, release: 1, gain: .1, bright: 500, dark: 90, bend: .92, sub: .5 });
    noise(o, r, { at: .9, type: 'low', f: 120, q: .7, attack: 1.2, decay: .9, gain: .4, color: .95 });
    drum(o, r, { at: 2.5, f: 45, gain: .4, decay: 3, slap: .2 }); noise(o, r, { at: 2.5, type: 'low', f: 300, q: .7, decay: 3, gain: .25, color: .7 });
  },
};

// Ambient beds loop seamlessly and never count as voices. Slow modulation, updated every 32 samples, completes
// whole cycles over each loop; noise layers are folded over their overhang.
const bed = (duration, render) => ({ bus: 'ambient', category: 'ambient', loop: true, duration, render, level: .7 });
// Bleak wind: a dark body that gusts, a low buffeting floor, a hollow moan off the ridges and a trace of ash.
R['ambient.wind'] = bed(8, (o, r) => {
  const n = o.length, overlap = Math.round(RATE), raw = new Float32Array(n + overlap), state = r.state;
  const body = new Filter(260, .8), floor = new Filter(70, .9), moan = new Filter(300, 7), ash = new Filter(2600, 1.2), phases = [r(), r(), r(), r(), r()];
  let brown = 0, gust = 0, howl = 0;
  for (let i = 0; i < raw.length; i++) {
    if ((i & 31) === 0) {
      const u = i / RATE / 8 % 1;
      body.set(270 + 120 * sin1((u + phases[0]) % 1) + 50 * sin1((3 * u + phases[1]) % 1)); moan.set(290 + 45 * sin1((2 * u + phases[2]) % 1));
      gust = .5 + .28 * sin1((u + phases[3]) % 1) + .14 * sin1((3 * u + phases[4]) % 1) + .08 * sin1((7 * u + phases[0]) % 1);
      howl = .6 * Math.max(0, gust - .45);
    }
    const white = nextRandom(state) * 2 - 1;
    brown = brown * .985 + white * .15;
    body.step(brown * 3); floor.step(brown * 2); moan.step(brown); ash.step(white);
    raw[i] = gust * (body.band + floor.band * .6 * gust + moan.band * howl) + ash.band * .025 * gust * gust;
  }
  o.set(loopFold(raw, overlap));
});
// Dark machinery: mains hum, a resonant drone and grinding under a machine cycle, soft knocks and valves.
R['ambient.industry'] = bed(5, (o, r) => {
  const n = o.length, overlap = Math.round(.6 * RATE), raw = new Float32Array(n + overlap), state = r.state;
  const drone = new Filter(130, 1.6), grind = new Filter(420, 2.2), floor = new Filter(65, 1);
  let brown = 0, throb = 0, churn = 0;
  for (let i = 0; i < raw.length; i++) {
    if ((i & 31) === 0) { const cycle = i / RATE % 1; throb = .8 * (.75 + .25 * sin1(cycle)); churn = .11 * (.6 + .4 * sin1(2 * cycle % 1)); }
    const white = nextRandom(state) * 2 - 1;
    brown = brown * .99 + white * .12;
    drone.step(brown * 3); grind.step(white); floor.step(brown * 3);
    raw[i] = drone.band * throb + grind.band * churn + floor.band * .3;
  }
  const noiseBed = loopFold(raw, overlap);
  const knocks = wrapped(n, scratch => {
    for (let i = 0; i < 10; i++) {
      const at = i / 2 + (r() - .5) * .01;
      modal(scratch, r, { at, f: 190 * jitter(r, .03), gain: i % 2 ? .2 : .3, hard: .0025, grit: .3, modes: [[1, 1, 40], [2.3, .5, 60], [3.9, .25, 90]] });
      noise(scratch, r, { at, type: 'low', f: 600, q: .7, decay: 50, gain: .16 });
      noise(scratch, r, { at: at + .25, type: 'band', f: 1100, q: 1.2, decay: 120, gain: .04 });
    }
    noise(scratch, r, { at: 2.7, type: 'band', f: 1800, q: .8, attack: .2, decay: 1.5, gain: .03, length: 1.2 });
  });
  // Every hum partial completes whole cycles over 5 s, so it needs no crossfade at the loop point.
  let swell = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    if ((i & 31) === 0) swell = .85 + .15 * sin1(t / 5 % 1);
    o[i] = noiseBed[i] + knocks[i] + (.18 * sin1(50 * t % 1) + .16 * sin1(100 * t % 1) + .09 * sin1(150 * t % 1)) * swell;
  }
});
// The distant front: a deep rolling rumble and far-off guns, heard more as the view widens and after fighting.
R['ambient.front'] = bed(8, (o, r) => {
  const n = o.length, overlap = Math.round(RATE), raw = new Float32Array(n + overlap), low = new Filter(60, .8), roll = new Filter(150, .9), state = r.state, phases = [r(), r()];
  let brown = 0, swell = 0, rolling = 0;
  for (let i = 0; i < raw.length; i++) {
    if ((i & 31) === 0) { const u = i / RATE / 8 % 1; swell = .6 + .4 * sin1((u + phases[0]) % 1); rolling = .5 * (.5 + .5 * sin1((2 * u + phases[1]) % 1)); }
    brown = brown * .985 + (nextRandom(state) * 2 - 1) * .15;
    low.step(brown * 3); roll.step(brown * 3);
    raw[i] = low.band * swell + roll.band * rolling;
  }
  const rumble = loopFold(raw, overlap);
  const guns = wrapped(n, scratch => {
    for (const [at, size] of [[.3 + .8 * r(), 1], [2.6 + r(), .7], [4.4 + .8 * r(), 1.2], [6.6 + .6 * r(), .8]]) {
      tone(scratch, { at, f: 60 * jitter(r, .1), to: 32, time: .25, attack: .01, decay: 4.5 / size, gain: .45 * size });
      noise(scratch, r, { at, type: 'band', f: 170, q: .7, attack: .02, decay: 3.5 / size, gain: 1.2 * size, color: .5 });
      noise(scratch, r, { at, type: 'band', f: 450, q: .8, attack: .01, decay: 9 / size, gain: .3 * size });
      noise(scratch, r, { at: at + .15, type: 'band', f: 120, q: .6, attack: .3, decay: 2.2 / size, gain: .6 * size, color: .7 });
    }
  });
  for (let i = 0; i < n; i++) o[i] = rumble[i] * .7 + guns[i];
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

// The shared reverb's impulse for audio.js: a dark outdoor space, rendered at the audio context's own rate.
// Sparse early reflections off nearby rock lead a diffuse tail whose highs die first; the two channels are
// independent. The raw response carries unit energy before its darkening filters, so its passband gain is
// about one and the mixer's send levels alone decide how wet a bus sounds.
export function renderImpulse(rate, seconds = 2.8) {
  const length = Math.round(seconds * rate), rand = seededRandom('impulse'), channels = [];
  const onset = Math.round(.018 * rate), swell = Math.round(.09 * rate), tail = Math.round(.04 * rate), fall = Math.exp(-6.9 * 64 / (length - onset));
  const glide = (400 / 3000) ** (64 / length), highpass = Math.exp(-TAU * 90 / rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = new Float32Array(length);
    for (let k = 0; k < 7; k++) data[Math.round((.009 + .016 * k * (1 + .35 * rand()) + .004 * channel) * rate)] = (rand() < .5 ? -3 : 3) * .8 ** k;
    // One pass, cheap enough to run cold once per context: the raw response (taps, then a swelling,
    // decaying diffuse field of xorshift noise) is measured for energy and darkened by three one-pole
    // lowpasses whose cutoff falls from 3 kHz to 400 Hz, then high-passed at 90 Hz. Envelope and cutoff
    // advance every 64 samples.
    let seed = rand() * 2147483647 | 1, level = .35 / 2147483648, gain = 0, energy = 0, cut = 3000, a = 0, low1 = 0, low2 = 0, low3 = 0, previous = 0, high = 0;
    for (let i = 0; i < length; i++) {
      if ((i & 63) === 0) {
        a = 1 - Math.exp(-TAU * cut / rate); cut *= glide;
        gain = i < onset ? 0 : level * Math.min(1, (i - onset) / swell, (length - i) / tail);
        if (i >= onset) level *= fall;
      }
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const x = data[i] + seed * gain;
      energy += x * x;
      low1 += (x - low1) * a; low2 += (low1 - low2) * a; low3 += (low2 - low3) * a;
      high = highpass * (high + low3 - previous); previous = low3;
      data[i] = high;
    }
    const norm = 1 / Math.sqrt(energy);
    for (let i = 0; i < length; i++) data[i] *= norm;
    channels.push(data);
  }
  return channels;
}

// Unit acknowledgements: wordless, speech-like lines from a small formant synthesizer. A Rosenberg glottal
// pulse with jitter, shimmer and breath drives four cascaded formant resonators, and stops, fricatives and
// nasals shape the syllables. Organics crews talk over a band-limited, gently saturated radio with static and
// noise squelch, the Vael launcher teams in a lower, growling register. Unity machines keep a low formant
// monotone, ring-modulated and comb-coloured, with data bursts and small digital dropouts. No real language
// is used.
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

// Male formant targets F1-F3 (Hz). Stressed syllables favour open, dark vowels; unstressed ones reduce.
const VOWELS = { a: [730, 1090, 2440], o: [570, 840, 2410], u: [440, 1020, 2240], e: [530, 1840, 2480], i: [390, 1990, 2550], ae: [660, 1720, 2410], uh: [640, 1190, 2390], er: [490, 1350, 1690], ax: [500, 1450, 2450] };
const STRESSED = ['a', 'a', 'o', 'uh', 'uh', 'e', 'ae', 'i', 'u', 'er'], REDUCED = ['ax', 'ax', 'i', 'uh', 'u'], GLIDES = { a: 'i', o: 'u', e: 'i' };
// Consonants: kind, noise band (Hz), noise gain, the F2 locus (Hz) formants start from, voiceless.
const CONSONANTS = {
  k: ['stop', 1900, .55, 1900, 1], t: ['stop', 2800, .5, 1750, 1], p: ['stop', 950, .35, 850, 1],
  g: ['stop', 1800, .35, 1900, 0], d: ['stop', 2600, .3, 1700, 0], b: ['stop', 850, .22, 850, 0],
  s: ['fric', 2900, .3, 1650, 1], sh: ['fric', 2300, .38, 1850, 1], f: ['fric', 1600, .14, 950, 1], h: ['breath', 0, 0, 0, 1],
  m: ['nasal', 0, 0, 1000, 0], n: ['nasal', 0, 0, 1650, 0], r: ['glide', 0, 0, 1250, 0], l: ['glide', 0, 0, 1050, 0],
};
const ONSETS = ['k', 'k', 't', 't', 'p', 'd', 'g', 'b', 's', 'sh', 'h', 'm', 'n', 'r', 'l', 'f'], CODAS = ['k', 't', 't', 'n', 's', 'r', 'm'];
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
// Crew pitch (Hz) and pace per role.
const VOICES = {
  rifle: [140, 1], rocket: [82, .82], scout: [162, 1.18], tank: [112, .9], artillery: [120, .86],
  striker: [150, 1.12], engineer: [132, 1], harvester: [104, .8], constructor: [118, .85],
};

// The formant core. segments: {at, end, av (voicing), ah (aspiration), f: [F1, F2, F3], stress}. Formants glide
// toward each segment's targets, so consonant loci become natural transitions into the vowel. The glottal
// source is the Rosenberg pulse's flow derivative: its abrupt closure carries the buzz. growl weakens every
// other pulse, a subharmonic rasp.
const BANDWIDTHS = [90, 110, 170, 260];
function formantVoice(out, rand, segments, { pitch, scale = 1, open = .44, close = .15, jitter = .012, shimmer = .1, breath = .06, growl = 0, glide = .07 }) {
  const first = Math.max(0, Math.round(segments[0].at * RATE)), last = Math.min(out.length, Math.round(segments.at(-1).end * RATE) + 240);
  const resonators = BANDWIDTHS.map(() => new Filter(500, 2)), f = [...segments[0].f.map(x => x * scale), 3350 * scale], state = rand.state;
  let index = 0, av = 0, ah = 0, accent = 0, frequency = 100, period = 1, level = 1, phase = 0, odd = false;
  for (let i = first; i < last; i++) {
    if ((i & 15) === 0) {
      const t = i / RATE;
      while (index < segments.length - 1 && t >= segments[index + 1].at) index++;
      const s = segments[index], inside = t >= s.at && t < s.end;
      av += ((inside ? s.av : 0) - av) * .35; ah += ((inside ? s.ah : 0) - ah) * .35; accent += ((inside ? s.stress : 0) - accent) * .05;
      for (let k = 0; k < 3; k++) f[k] += (s.f[k] * scale - f[k]) * glide;
      for (let k = 0; k < 4; k++) resonators[k].set(f[k], f[k] / BANDWIDTHS[k]);
      frequency = pitch(t) * (1 + .07 * accent);
    }
    const dt = frequency * period / RATE;
    phase += dt;
    if (phase >= 1) { phase -= 1; odd = !odd; period = 1 + (nextRandom(state) - .5) * 2 * jitter; level = (1 + (nextRandom(state) - .5) * 2 * shimmer) * (odd ? 1 - growl : 1); }
    let x = phase < open ? close / open * sin1(phase / (2 * open)) : phase < open + close ? -sin1((phase - open) / (4 * close)) : 0;
    x = av * level * (x + .5 * blep((phase - open - close + 1) % 1, dt)) + (nextRandom(state) * 2 - 1) * (ah + av * breath * (phase < open + close ? 1 : .3));
    for (let k = 0; k < 4; k++) x = resonators[k].step(x);
    out[i] += x;
  }
}

// Field radio: a steep 300 Hz-3 kHz channel, gentle saturation and a last low-pass for the clipped edges.
function radio(out, { low = 300, high = 3000, drive = 2.4 } = {}) {
  const h1 = new Filter(low, .54), h2 = new Filter(low, 1.31), l1 = new Filter(high, .54), l2 = new Filter(high, 1.31), tidy = new Filter(high * 1.25, .7);
  for (let i = 0; i < out.length; i++) {
    h1.step(out[i]); h2.step(h1.high);
    out[i] = tidy.step(soft(l2.step(l1.step(h2.high)) * drive));
  }
}
// Keying: a click and a breath of carrier as the channel opens; on release the squelch tail lets through a
// burst of band noise that falls quiet within a sixth of a second.
function squelch(out, rand, open, close) {
  noise(out, rand, { at: open, type: 'high', f: 900, q: .6, decay: 140, gain: .35 });
  noise(out, rand, { at: close, type: 'high', f: 700, q: .6, decay: 300, gain: .4 });
  noise(out, rand, { at: close + .004, type: 'band', f: 1700, q: .45, attack: .004, decay: 16, gain: .5, length: .17 });
}

function humanLine(rand, role, context, family) {
  const shape = CONTOURS[context], [base, pace] = VOICES[role], vael = family === 'vael';
  const count = shape.syllables[0] + Math.floor(rand() * (shape.syllables[1] - shape.syllables[0] + 1));
  const tempo = shape.tempo * pace * (vael ? .85 : 1), segments = [], bursts = [];
  let t = .08;
  const segment = (length, av, ah, f, stress = 0) => { segments.push({ at: t, end: t + length, av, ah, f, stress }); t += length; };
  const consonant = (name, vowel, onset) => {
    const [kind, band, gain, locus, voiceless] = CONSONANTS[name], near = [Math.min(vowel[0], 380), locus, vowel[2]];
    if (kind === 'stop') {
      segment((.035 + .025 * rand()) / tempo, voiceless ? 0 : .08, 0, near);
      if (onset || rand() < .5) bursts.push({ at: t, f: band, gain: onset ? gain : gain * .5 });
      if (onset && voiceless) segment((.025 + .02 * rand()) / tempo, 0, .45, vowel);
    } else if (kind === 'fric') { const length = (.055 + .035 * rand()) / tempo; bursts.push({ at: t, f: band, gain, length }); segment(length, 0, .03, near); }
    else if (kind === 'breath') segment(.045 / tempo, 0, .5, vowel);
    else if (kind === 'nasal') segment((.045 + .02 * rand()) / tempo, .5, 0, [260, locus, 2350]);
    else segment(.04 / tempo, .8, 0, name === 'r' ? [460, 1250, 1650] : [380, 1050, 2650]);
  };
  // Words of one to three syllables, stressed on the first; vowels vary a little in every syllable and some
  // stressed ones glide as diphthongs.
  for (let s = 0; s < count; s++) {
    const word = s === 0 || rand() < .38, last = s === count - 1, name = pick(rand, word ? STRESSED : REDUCED), vowel = VOWELS[name].map(f => f * jitter(rand, .04));
    if (word && s) t += (.025 + .045 * rand()) / tempo;
    if (rand() < (word ? .85 : .6)) consonant(pick(rand, ONSETS), vowel, true);
    const length = ((word ? .085 : .05) + .045 * rand()) * (last ? 1.45 : 1) / tempo;
    if (word && GLIDES[name] && rand() < .4) { segment(length * .55, 1, .02, vowel, 1); segment(length * .45, .85, .02, VOWELS[GLIDES[name]], 1); }
    else segment(length, word ? 1 : .7, .02, vowel, word ? 1 : 0);
    if (rand() < (last ? .55 : .3)) consonant(pick(rand, CODAS), vowel, false);
  }
  // A slow speaker's long line is tightened, so no transmission keys the radio for much over two seconds.
  const fit = Math.min(1, 2 / t);
  if (fit < 1) { for (const s of segments) { s.at *= fit; s.end *= fit; } for (const b of bursts) { b.at *= fit; b.length &&= b.length * fit; } t *= fit; }
  const end = t, out = new Float32Array(Math.round((end + .22) * RATE)), f0 = base * (vael ? 1 : jitter(rand, .05)), wobble = rand();
  formantVoice(out, rand, segments, {
    pitch: time => f0 * shape.pitch(Math.min(1, time / end)) * (1 + .012 * sin1((5.3 * time + wobble) % 1)),
    scale: vael ? .82 : 1, breath: vael ? .14 : .06, growl: vael ? .4 : 0, open: vael ? .5 : .44, close: vael ? .2 : .15,
  });
  normalize(out);
  // A larger vocal tract lowers the consonants' noise resonances along with the formants.
  const tract = vael ? .8 : 1;
  for (const burst of bursts) noise(out, rand, burst.length
    ? { at: burst.at, type: 'band', f: burst.f * tract, q: 1.8, attack: .015, decay: 6, gain: burst.gain, length: burst.length }
    : { at: burst.at, type: 'band', f: burst.f * tract, q: 1.1, decay: 240, gain: burst.gain });
  if (context === 'annoyed') noise(out, rand, { at: .05, type: 'band', f: 1200, q: .5, attack: .03, decay: 18, gain: .1 });
  noise(out, rand, { at: .012, type: 'band', f: 1800, q: .5, attack: .01, decay: .01, gain: .045, length: end, grain: .8, grainRate: 30 });
  squelch(out, rand, .01, end + .012);
  radio(out, vael ? { low: 250, high: 2500, drive: 3 } : {});
  return out;
}

// Machine registers: carrier pitch (Hz), formant scale, ring-modulation frequency (Hz), comb delay (ms).
const MACHINES = {
  rifle: [88, .95, 61, 3.1], rocket: [70, .88, 47, 3.9], scout: [104, 1.06, 77, 2.6], tank: [56, .8, 37, 4.7], artillery: [64, .84, 43, 4.3],
  striker: [96, 1, 69, 2.9], engineer: [92, 1.02, 57, 3.4], harvester: [60, .82, 41, 4.4], constructor: [50, .78, 33, 5.2],
};
const MACHINE_VOWELS = [[600, 1000, 2300], [420, 900, 2200], [520, 1500, 2400], [700, 1200, 2500], [360, 1700, 2400], [480, 1300, 2000]];
// Digital artefacts: a dropped frame dips the line almost to silence; a repeated frame stutters.
function dropout(out, at, length) {
  const start = Math.round(at * RATE), span = Math.round(length * RATE), edge = 36;
  for (let n = 0; n < span + 2 * edge && start + n < out.length; n++) out[start + n] *= .06 + .94 * (n < edge ? 1 - n / edge : n < edge + span ? 0 : (n - edge - span) / edge);
}
function repeat(out, at, length, times) {
  const start = Math.round(at * RATE), span = Math.round(length * RATE), edge = 48;
  for (let k = 1; k <= times; k++) for (let n = 0; n < span && start + k * span + n < out.length; n++) out[start + k * span + n] = out[start + n] * Math.min(1, n / edge, (span - n) / edge);
}
// Machine colour: partial ring modulation for metallic sidebands, a short feedback comb for the resonant
// chassis, then a 100 Hz-3.6 kHz band driven into a small speaker's saturation.
function machine(out, ring, comb) {
  const delay = new Float32Array(Math.max(2, Math.round(comb * RATE))), hp = new Filter(100, .7), lp = new Filter(3600, .7);
  let index = 0, carrier = 0;
  for (let i = 0; i < out.length; i++) {
    carrier += ring / RATE; if (carrier >= 1) carrier -= 1;
    const y = out[i] * (.4 + .6 * sin1(carrier)) + .5 * delay[index];
    delay[index] = y; if (++index === delay.length) index = 0;
    hp.step(y); out[i] = soft(lp.step(hp.high) * 2.2);
  }
}
function unityLine(rand, role, context) {
  const shape = CONTOURS[context], [f0, scale, ring, comb] = MACHINES[role], glitch = context === 'annoyed', link = context === 'transmission', segments = [], ticks = [];
  const count = shape.syllables[0] + Math.floor(rand() * (shape.syllables[1] - shape.syllables[0] + 1));
  let t = link ? .17 : .07;
  for (let s = 0; s < count; s++) {
    if (s && rand() < .45) { ticks.push(t); t += .014; }
    const length = (.065 + .05 * rand()) / shape.tempo * (s === count - 1 ? 1.35 : 1);
    segments.push({ at: t, end: t + length, av: 1, ah: .015, f: pick(rand, MACHINE_VOWELS), stress: 0 });
    t += length + (rand() < .3 ? .035 : .009);
  }
  // A monotone that only steps at the end: up for a query, down for a statement, further down when annoyed.
  const end = t, out = new Float32Array(Math.round((end + .12) * RATE)), step = context === 'select' || context === 'ready' ? 1.05 : glitch ? .84 : .93;
  formantVoice(out, rand, segments, { pitch: time => f0 * (time > end - .1 ? step : 1), scale, open: .5, close: .1, jitter: 0, shimmer: 0, breath: 0, glide: .45 });
  normalize(out);
  for (const at of ticks) noise(out, rand, { at, type: 'band', f: 2300, q: 1.4, decay: 420, gain: .4 });
  dataBurst(out, rand, .012, link ? .14 : .045, link ? .3 : .22);
  if (glitch) repeat(out, segments[0].at, .032, 2);
  if (link || rand() < .5) dropout(out, segments[Math.floor(rand() * segments.length)].at + .02, .008 + .01 * rand());
  machine(out, ring, comb / 1000);
  return out;
}

export function renderVoice(key, variant = 0) {
  const voice = parseVoiceKey(key);
  if (!voice) throw new RangeError(`Unknown voice ${key}`);
  const rand = seededRandom(`${key}#${variant}`);
  const out = voice.family === 'unity' ? unityLine(rand, voice.role, voice.context) : humanLine(rand, voice.role, voice.context, voice.family);
  return finish(out, { level: VOICE_RECIPE.level, fadeIn: .002 });
}
