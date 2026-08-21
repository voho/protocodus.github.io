/* Sound, synthesised.

   No files. Everything here is an oscillator or a couple of seconds of noise
   generated once at startup and filtered differently for each job, which
   keeps the whole game to the three hundred kilobytes of three.js and costs
   nothing to load. There are no audio assets in this project and there is not
   going to be one.

   Most of what you hear is continuous and driven straight from the physics,
   which is the point: the wind is the rider's speed, the hiss is how hard the
   edge is working, and the snow under the board stops dead the moment the
   board leaves it. That silence is the single most effective thing in here —
   a jump is quiet, and the landing is loud, and the ear gets the whole story
   without a single sample being triggered by an event.

   There are six continuous voices now rather than two, and the split is the
   whole of what changed.

   The air is two of them. A rush, which is the body of it, and a whistle
   above it that only exists past about half speed — because a wind voice that
   simply gets louder is a fan getting closer, and what a run actually does is
   climb. The rush is also the only voice that survives a jump: you are still
   moving through air at forty metres a second, and cutting it entirely made
   every landing sound like a tab being switched back to.

   The snow is the other three, and they all go to nothing in the air. A
   rumble, which is the board over the ground and rises with speed. An edge,
   which is the carve — a tight, high hiss whose level comes off `carveLoad`,
   the same number the physics uses for how hard the edge is being asked to
   hold. And a wash, which is the slide, broad and low and completely
   separate. Those last two used to be one voice fed only by the slide, so a
   railed carve at a hundred kilometres an hour — the most committed thing you
   can do on a snowboard — was silent, and the only way to make a noise was to
   lose the edge. Now the carve sings and the slide roars, and they are
   different sounds because they are different things happening to the snow.
   The sixth is the scrape of a fallen body: silent in the air and driven by
   actual contact speed once the tumble reaches the hill.

   Everything is behind a user gesture, because browsers require it and
   because a page that starts making noise on its own deserves what it gets. */

import { RIDER } from './config.js';

const NOISE_SECONDS = 2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createAudio() {
  let ctx = null;
  let master = null;
  let brownBuf = null;
  let whiteBuf = null;
  let rush = null;
  let whistle = null;
  let rumble = null;
  let edge = null;
  let wash = null;
  let scrape = null;
  let voices = [];
  let muted = false;
  let started = false;
  let lastBodyImpact = -Infinity;
  /* `parked` is our own record of having deliberately put the context to
     sleep, kept separately from `ctx.state` because suspend and resume are
     both asynchronous — the state lags the intent by however long the
     browser takes, and the intent is the thing every guard below actually
     wants to know. */
  let parked = false;
  let parkTimer = 0;
  let ambienceAt = 0;

  try {
    muted = localStorage.getItem('alpen.muted') === '1';
  } catch { /* private mode; the default stands */ }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    /* A hard landing sums the land mix, the stomp and six ambient voices —
       comfortably past unity into the destination, which clips digitally on
       every big hit. A gentle limiter on the way out lets the loud moments
       stay loud without the crack: high ratio, soft knee, fast enough attack
       that the transient is caught rather than let through. */
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 24;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(ctx.destination);

    /* Two noises, because a rush and a hiss are not the same material.

       Brown-ish noise — white through a leaky integrator — is what wind and
       a board over snow are made of; white through a speaker is a fault
       report. But a hiss is the opposite problem: the edge cutting and the
       spray leaving it are almost all top end, and a resonant filter has
       nothing to find up there in a signal that falls off at six decibels an
       octave. So the high voices get their own flat noise and the low ones
       keep the brown. */
    const len = ctx.sampleRate * NOISE_SECONDS;
    brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    whiteBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = brownBuf.getChannelData(0);
    const w = whiteBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const n = Math.random() * 2 - 1;
      last = (last + 0.024 * n) / 1.024;
      b[i] = last * 3.2;
      w[i] = n * 0.7;
    }

    const loop = (buffer, type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filter).connect(g).connect(master);
      src.start();
      return { src, filter, gain: g };
    };

    rush = loop(brownBuf, 'lowpass', 700, 0.7);
    whistle = loop(whiteBuf, 'bandpass', 1100, 2.6);
    rumble = loop(brownBuf, 'lowpass', 160, 1.1);
    edge = loop(whiteBuf, 'bandpass', 2600, 3.4);
    wash = loop(brownBuf, 'bandpass', 900, 0.8);
    // A fallen rider is clothing, board and body dragging through snow, not
    // an edged snowboard. Keeping that scrape on its own voice lets it begin
    // only when the tumble has reached the ground and stop again on a bounce.
    scrape = loop(whiteBuf, 'bandpass', 1050, 0.95);
    voices = [rush, whistle, rumble, edge, wash, scrape];
    return true;
  }

  /* Called on every resume, not just the first. Browsers suspend an
     AudioContext when the tab goes to the background or the device takes
     the audio away, and returning early on `started` left the graph running
     into a suspended context — permanently silent, with the HUD still
     saying the sound was on. */
  function start() {
    if (!ctx && !build()) return;
    started = true;
    parked = false;
    clearTimeout(parkTimer);
    ambienceAt = 0;
    /* Every call to `start` arrives from a user gesture — the curtain's click
       or a keydown in `begin` — which is precisely the condition
       under which a browser permits `resume`, whether the context was
       suspended by `quiet` below or by the platform taking the audio away.
       Tested against anything-but-running rather than 'suspended': iOS
       reports the non-standard 'interrupted' after a phone call or Siri,
       and matching only 'suspended' left those sessions permanently silent
       with the HUD still saying sound was on. The catch covers a context
       that has been closed under us, where resume() rejects. */
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  const now = () => (ctx ? ctx.currentTime : 0);

  /* --- the six continuous voices --------------------------------------- */

  /* `carveLoad` is optional only so that a caller which has not been updated
     still makes a sensible noise: without it the edge simply never sings and
     everything else behaves exactly as before. */
  function ambience(speed, slide, grounded, storm, carveLoad = 0, tumbleSlide = 0, surf = null) {
    /* Not gated on `muted`: the master gain is already zero, so the voices
       are silent either way, and the gains have to keep tracking the run —
       frozen at their pre-mute values, unmuting at a standstill replayed a
       third of a second of 120 km/h wind before the ramps caught up. */
    if (!started || !ctx || parked) return;

    const ms = performance.now();
    if (ms - ambienceAt < 35) return;
    ambienceAt = ms;

    const t = now();
    const v = Math.min(1, speed / 42);
    const on = grounded ? 1 : 0;

    const ice = surf ? surf.ice : 0;
    const rock = surf ? surf.rock : 0;
    const powder = surf ? surf.powder : 0;

    /* Gusting, computed here rather than with an LFO node because it is two
       sines and a multiply. A wind held at a constant level is a fan; what
       makes it read as weather is that it never quite settles. */
    const gust = 1 + 0.22 * Math.sin(t * 0.71) * Math.sin(t * 0.23 + 1.7);

    // The air. It rises with the square of speed, which is roughly what the
    // real thing does, and it is the one voice a jump does not take away.
    rush.gain.gain.setTargetAtTime((0.04 + v * v * 0.40 + storm * 0.16) * gust * (grounded ? 1 : 0.82), t, 0.12);
    rush.filter.frequency.setTargetAtTime(260 + v * v * 1500 + storm * 240, t, 0.2);

    // And above it, the whistle: nothing at all until the run is genuinely
    // quick, then a climb. This is the voice the ear reads as speed.
    const fast = Math.max(0, v - 0.45) / 0.55;
    whistle.gain.gain.setTargetAtTime(fast * fast * 0.10 * gust * (grounded ? 1 : 0.9), t, 0.15);
    whistle.filter.frequency.setTargetAtTime(950 + fast * 1750, t, 0.25);

    // The board over the ground: higher pitch chatter on ice, deep bass on powder, rougher on rock
    const rumbleFreq = 95 + v * 200 + ice * 120 - powder * 30 + rock * 150;
    rumble.gain.gain.setTargetAtTime((0.025 + v * v * 0.17 + rock * 0.08) * on, t, 0.09);
    rumble.filter.frequency.setTargetAtTime(rumbleFreq, t, 0.15);

    // The edge, holding. High-pitched metallic chime on ice, soft swoosh on powder
    const load = clamp01(carveLoad);
    const edgeFreq = 2300 + load * 2400 + v * 800 + ice * 900 - powder * 400;
    edge.gain.gain.setTargetAtTime(load * load * (0.05 + v * 0.22 + ice * 0.06) * on, t, 0.05);
    edge.filter.frequency.setTargetAtTime(edgeFreq, t, 0.08);

    // The edge, gone. Broad, low slide wash, with higher frequency on ice
    const skid = clamp01(slide / 10);
    const washFreq = 650 + Math.min(slide, 14) * 145 + ice * 350;
    wash.gain.gain.setTargetAtTime((skid * (0.09 + v * 0.15) + rock * 0.10) * on, t, 0.05);
    wash.filter.frequency.setTargetAtTime(washFreq, t, 0.08);

    // The contact half of a fall or rock scrubbing
    const drag = clamp01(tumbleSlide / 24);
    const rockScrape = rock * (v * 0.15);
    scrape.gain.gain.setTargetAtTime((drag * (0.045 + drag * 0.16) + rockScrape) * (grounded ? 1 : 0), t, 0.035);
    scrape.filter.frequency.setTargetAtTime(720 + (drag + rock) * 1500, t, 0.07);
  }

  /* --- one-shots ------------------------------------------------------- */

  /* Both one-shot builders refuse to schedule into a parked context. Nothing
     should be asking — the simulation that fires them stops when the game
     pauses — but a sound scheduled against a suspended clock would sit in the
     queue and all play at once, stale, on the next resume, which is worse
     than the sound simply not happening. */
  function tone(freq, endFreq, dur, gain, type = 'sine', delay = 0) {
    if (!started || !ctx || parked) return;
    const t = now() + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function burst(dur, freq, gain, type = 'lowpass', sweepTo = null, delay = 0, buffer = null) {
    if (!started || !ctx || parked) return;
    const t = now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = buffer || brownBuf;
    src.loop = true;
    // Somewhere different in the noise every time, so a run of landings does
    // not play the identical two seconds of grain over and over
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * (NOISE_SECONDS * 0.5));
    src.stop(t + dur + 0.05);
  }

  return {
    start,
    ambience,
    get muted() { return muted; },
    get running() { return started; },
    // For the debug hatch, and for checking that a suspended context has
    // actually been brought back rather than assumed to be running
    get context() { return ctx; },

    toggleMute() {
      muted = !muted;
      // Ramped, not written: an instantaneous gain step under six running
      // voices is a discontinuity in the waveform — an audible click on
      // every press of M. Twenty milliseconds is below perception as a fade
      // and above it as a pop.
      if (master) {
        if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.02);
        else master.gain.value = muted ? 0 : 0.55;
      }
      try { localStorage.setItem('alpen.muted', muted ? '1' : '0'); } catch { /* ignore */ }
      return muted;
    },

    // A pop, not a boing: the board leaves the snow, it does not launch
    jump(power) {
      tone(180 + power * 90, 70, 0.20, 0.18);
      burst(0.13, 2400, 0.10, 'highpass', null, 0, whiteBuf);
    },

    // A synthesized chime for slalom gate streaks. Pitch increases with the streak.
    chime(streak) {
      const baseFreq = 523.25; // C5
      // Pitch goes up a major scale degree approximately (simplified as 1.1x per step)
      const freq = baseFreq * Math.pow(1.122, Math.min(streak - 1, 12));
      tone(freq, freq * 0.95, 0.35, 0.25, 'sine');
      tone(freq * 1.5, freq * 1.45, 0.25, 0.15, 'triangle', 0.05);
    },

    /* A sub-bass thud for heavy stomps. The tone bottoms out at 45 Hz, not
       20: nothing most speakers own reproduces 20 Hz, so the tail of the old
       sweep was pure cone excursion — rattle, not bass. And it sits a step
       under the old level because it plays *on top of* `land`, which is
       already the loudest mix in the file; the pair used to sum well past
       clipping on every big landing. */
    stomp(intensity) {
      const k = clamp01(intensity);
      tone(80 + k * 40, 45, 0.35 + k * 0.2, 0.16 + k * 0.10, 'sine', 0);
      burst(0.3, 1200 + k * 800, 0.09 + k * 0.06, 'lowpass', 150);
    },

    /* Everything the snow takes, all at once.

       It used to be one number over eighteen, which meant a two-metre drop
       and a cliff arrived at the ear as very nearly the same event. The
       weight is now judged against the physics' own thresholds — `softImpact`
       is where the legs stop absorbing it and `hardImpact` is where the
       rider stops surviving it — so the sound and the body agree about what
       a heavy landing is instead of each holding a private opinion.

       Three layers, and which of them are present is the information. Snow
       always. A thump once there is any weight behind it. And under a real
       impact, a sub that arrives a hair late and a crack of broken crust on
       top, which together are the difference between landing and hitting. */
    land(impact) {
      const k = clamp01(impact / RIDER.hardImpact);
      const soft = clamp01(impact / RIDER.softImpact);
      burst(0.20 + k * 0.36, 700 + k * 1400, 0.08 + k * 0.26, 'lowpass', 170);
      tone(115 + k * 95, 38, 0.13 + k * 0.17, 0.08 + k * 0.16);
      if (soft > 0.45) {
        tone(64, 26, 0.22 + k * 0.24, 0.05 + k * 0.15, 'sine', 0.01);
        burst(0.10 + k * 0.12, 3200, 0.03 + k * 0.09, 'highpass', null, 0.015, whiteBuf);
      }
      // The powder coming back down, a beat behind the rider
      if (soft > 0.8) burst(0.30 + k * 0.3, 1800, 0.05 + k * 0.08, 'bandpass', 600, 0.09, whiteBuf);
    },

    // Rising blips, one per half rotation, so a 720 sounds like a 720
    trick(step) {
      tone(520 * Math.pow(1.16, step), 700 * Math.pow(1.16, step), 0.10, 0.10, 'triangle');
    },

    combo(mult) {
      tone(440 * Math.pow(1.06, mult), 880 * Math.pow(1.06, mult), 0.18, 0.09, 'triangle');
      tone(660 * Math.pow(1.06, mult), 1320, 0.16, 0.05, 'sine', 0.05);
    },

    /* A fall is a sequence rather than a louder landing: broken crust first,
       then the weight of the body, then snow and clothing scraping away.
       `impact` is the same m/s value the physics used to throw the rider, so
       a soft washout and a high-speed collision share a sound family without
       ever being mistaken for the same event. */
    crash(impact = RIDER.softImpact, cause = 'land') {
      const k = clamp01(Math.max(0, impact) / RIDER.hardImpact);
      const weight = 0.28 + k * 0.72;

      // Crust and powder at the contact point.
      burst(0.18 + k * 0.28, 1050 + k * 1250,
        0.08 + weight * 0.22, 'lowpass', 170);
      burst(0.09 + k * 0.11, 2900 + k * 1700,
        0.025 + weight * 0.085, 'highpass', null, 0.008, whiteBuf);

      // The body arrives just after the snow, with a clean sub rather than
      // the buzzy sawtooth that made the old crash sound like an alarm.
      tone(104 + k * 54, 31, 0.18 + k * 0.25,
        0.055 + weight * 0.14, 'sine', 0.012);
      if (k > 0.32) tone(58, 25, 0.30 + k * 0.20, 0.04 + k * 0.10, 'sine', 0.025);

      // A hard obstacle adds the short clack of board/bindings; a landing
      // bail stays all snow and body.
      if ((cause === 'hit' || cause === 'bear') && k > 0.2) {
        tone(310 + k * 180, 92, 0.095 + k * 0.06,
          0.035 + k * 0.07, 'triangle', 0.006);
      }

      // Loose powder and clothing dragging away from the first hit.
      burst(0.24 + k * 0.56, 1750 + k * 850,
        0.035 + weight * 0.10, 'bandpass', 620, 0.065, whiteBuf);
    },

    /* Secondary contacts during the ragdoll. A short gate prevents closely
       spaced terrain samples from becoming a machine-gun while preserving
       distinct, diminishing thumps as the rider actually bounces. */
    bodyImpact(impact) {
      if (!started || !ctx || parked) return;
      const t = now();
      if (t - lastBodyImpact < 0.11) return;
      lastBodyImpact = t;
      const k = clamp01(Math.max(0, impact) / (RIDER.hardImpact * 0.7));
      if (k < 0.06) return;
      burst(0.10 + k * 0.16, 780 + k * 720,
        0.035 + k * 0.12, 'lowpass', 155);
      tone(88 + k * 38, 32, 0.12 + k * 0.13,
        0.025 + k * 0.075, 'sine', 0.006);
      if (k > 0.38) {
        burst(0.08 + k * 0.08, 3100, 0.018 + k * 0.05,
          'highpass', null, 0.004, whiteBuf);
      }
    },

    // Rear boot through soft snow: a short granular scrape with just enough
    // low body to make the plant feel weight-bearing rather than decorative.
    push(strength = 1) {
      const k = clamp01(strength);
      burst(0.11 + k * 0.08, 2100, 0.035 + k * 0.055,
        'bandpass', 720, 0, whiteBuf);
      tone(92, 48, 0.10, 0.018 + k * 0.022, 'sine', 0.012);
    },

    // A near miss is a whoosh past the ear, and the only reward for taking
    // a line close enough to a tree to regret it
    whoosh() {
      burst(0.22, 700, 0.16, 'bandpass', 2600);
    },

    thud() {
      burst(0.18, 500, 0.16, 'lowpass', 160);
    },

    quiet() {
      if (!started || !ctx) return;
      const t = now();
      for (let i = 0; i < voices.length; i++) voices[i].gain.gain.setTargetAtTime(0, t, 0.06);
      /* Then stop the whole machine. A paused game used to keep six sources
         looping into gains of zero — the audio thread doing full-time work to
         produce silence — for as long as the curtain was up or the tab was in
         the background. The suspend waits out the fade above first, because
         suspending mid-ramp freezes the ramp and the pause arrives as a
         click; and it checks `parked` again when the timer lands, because a
         resume inside those few hundred milliseconds has already made the
         suspension wrong. */
      parked = true;
      clearTimeout(parkTimer);
      parkTimer = setTimeout(() => {
        // Anything that is not already asleep gets put to sleep — a platform
        // can report 'interrupted' rather than 'running', and a refusal is
        // fine: the gains are at zero either way.
        if (parked && ctx.state !== 'suspended' && ctx.state !== 'closed') {
          ctx.suspend().catch(() => { /* muted is silent enough */ });
        }
      }, 350);
    },
  };
}
