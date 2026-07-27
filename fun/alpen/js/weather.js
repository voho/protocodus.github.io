/* Time of day, and what the sky is doing.

   Three dials now, all continuous, and nothing in the game reads a preset
   name except the HUD.

   `tod` runs a full day in six minutes of riding. It is interpolated
   through a table of seven moments — night, dawn, morning, day, golden,
   dusk, nightfall — and every one of them carries the whole picture: the
   three stops of the sky gradient, the colour of the haze, the colour and
   strength of the key light, how high it sits, and how much of the star
   field shows through. Because the table is interpolated rather than
   switched, there is no moment at which the sky changes; there is only ever
   a sky that has been changing.

   `storm` drifts on slow noise between clear air and a whiteout. It is not
   a separate weather system so much as a second axis over the first: it
   pulls every colour towards the haze, brings the fog in from four hundred
   metres to seventy, takes half the light out, and turns the snowfall from
   a few flakes into something you steer through. A blizzard at dusk and a
   blizzard at noon are recognisably the same weather and completely
   different places, which is the whole reason to have two dials instead of
   a list of six skies.

   `aurora` is the third, and it is zero on most nights by construction. It
   runs on the weather's own clock like the storm does, thresholded, and then
   passed through two more gates: how deep the night is, and the storm, which
   smothers a display exactly as it already smothers the stars. None of those
   three know about each other, so a display has to *arrive* during a night
   that happens to be clear, and the odds of that are what make it read as
   luck rather than as a feature. When one does land it takes about a minute
   to build, hold and go — which is most of a night, and all of the reason it
   feels like it was already happening before you looked up. About a quarter
   of nights get something; the rest are just nights, which is the point. An
   aurora every night is a green sky, not an aurora.

   The one liberty taken with the sun: at night it is the moon, and it is
   allowed to be far brighter than the real one, because a mountain you
   cannot see is not a mountain you can ride. */

import { noise2 } from './noise.js';
import { RENDER } from './config.js';

const PHASES = [
  {
    at: 0.00, name: 'NIGHT',
    zenith: '#030713', mid: '#0a1a38', horizon: '#17294b', haze: '#1b2c4c',
    key: '#a8c0e8', glow: '#6f8cc0', keyI: 0.76, hemiI: 0.55,
    elevation: 0.46, star: 1, moon: 1,
  },
  {
    at: 0.13, name: 'DAWN',
    zenith: '#132a60', mid: '#4c5f96', horizon: '#f0a878', haze: '#b7a49b',
    key: '#ffb98a', glow: '#ff9d63', keyI: 2.07, hemiI: 0.95,
    elevation: 0.06, star: 0.22, moon: 0.15,
  },
  /* The three daylight moments carry the whole look, and they are much
     deeper than they were.

     A real alpine sky at altitude is not pale — there is a third less
     atmosphere over it than at sea level, so the zenith goes to something
     close to navy and holds real blue most of the way down, and the thing
     that makes a photograph of snow read as snow is that violent contrast
     between a near-black sky and a surface at the top of the scale. These
     used to run from a mid blue to a horizon that was almost white, which
     averaged out to the pale grey-cream the whole picture had settled into.
     The horizon stops are still bright, because that is where the haze and
     the distance genuinely are; it is the top of the dome that has come
     down, and the fill light with it, so shadows on the snow are blue
     instead of grey. */
  {
    at: 0.28, name: 'MORNING',
    zenith: '#0d3585', mid: '#3f83d8', horizon: '#dfeaf6', haze: '#dce5f0',
    key: '#fff4dc', glow: '#ffdcae', keyI: 3.9, hemiI: 1.05,
    elevation: 0.30, star: 0, moon: 0,
  },
  {
    at: 0.48, name: 'DAY',
    zenith: '#07297a', mid: '#2f79d6', horizon: '#e4eefb', haze: '#e3ecf6',
    key: '#fffaf0', glow: '#ffeccc', keyI: 4.5, hemiI: 1.12,
    elevation: 0.62, star: 0, moon: 0,
  },
  {
    at: 0.68, name: 'GOLDEN HOUR',
    zenith: '#122f78', mid: '#5a89c8', horizon: '#ffd79a', haze: '#e7d9c3',
    key: '#ffcb8a', glow: '#ff9f45', keyI: 3.9, hemiI: 0.95,
    elevation: 0.22, star: 0, moon: 0,
  },
  {
    at: 0.81, name: 'DUSK',
    zenith: '#101c4a', mid: '#424c88', horizon: '#e08a63', haze: '#a68990',
    key: '#ff9a6a', glow: '#ff7a45', keyI: 1.93, hemiI: 0.8,
    elevation: 0.05, star: 0.32, moon: 0.3,
  },
  {
    at: 0.92, name: 'NIGHTFALL',
    zenith: '#050b1e', mid: '#0f2145', horizon: '#23335a', haze: '#1e2f50',
    key: '#9db5df', glow: '#6b88bd', keyI: 0.83, hemiI: 0.55,
    elevation: 0.40, star: 0.9, moon: 0.95,
  },
];

const BANDS = [
  { to: 0.14, name: 'CLEAR' },
  { to: 0.34, name: 'LIGHT SNOW' },
  { to: 0.58, name: 'SNOWING' },
  { to: 0.80, name: 'HEAVY SNOW' },
  { to: 1.01, name: 'BLIZZARD' },
];

/* How long everything takes, and all three of these went up a long way.

   A six-minute day sounds generous written down and is frantic to ride: the
   sun crosses the sky at a visible rate, dusk arrives while you are still in
   the air off one jump, and because every colour in the frame is interpolated
   from this one clock, the entire picture is permanently mid-transition.
   Nothing ever settles long enough to *be* a time of day. Fifteen minutes is
   still four times faster than a real morning and it is slow enough that the
   light on the snow looks like a condition rather than an animation.

   The storm clock went the same way for the same reason. Weather that turns
   over every minute is not weather, it is a strobe — and this one drives the
   fog distance, so a fast storm dial is also a horizon that visibly breathes
   in and out. At a hundred and ten seconds a front takes a couple of minutes
   to arrive, which is long enough to watch it coming. */
const DAY_SECONDS = 900;
const START_TOD = 0.34;      // a bright morning, so the first look is the best one
const STORM_PERIOD = 110;    // seconds per unit of the noise that drives it

/* The aurora, in five numbers.

   `period` is long against a six-minute day on purpose: the display has to
   be slower than the night it happens in, or it flickers on and off across
   one and reads as a light being switched rather than as weather. At 150
   seconds a display takes about a minute to build, hold and go, which is
   most of a night and all of the reason it feels like it was happening
   before you looked up.

   `from` and `to` are where that noise is cut. They are not as high up its
   range as they look — two fifths of the clock is over `from` and a
   twenty-fifth over `to` — because the rarity is not meant to come from the
   threshold. It comes from the two gates after it. `night` is how deep the
   night has to be, and it is deep enough that dusk and dawn both fail it,
   which is right: an aurora in a sky that still has light in it is not
   something anyone has seen. And the storm gate is the same one the stars
   get, because cloud does not care how big the thing behind it is.

   What those three multiply out to, measured over sixty hours of clock and
   six hundred nights: a quarter of the nights have something on them, a
   tenth have a display worth stopping for, the ones that fire last about
   fifty seconds, and the rest are just nights. Which is the point. */
const AURORA = {
  period: 150,
  from: 0.60,
  to: 0.82,
  night: [0.55, 0.92],
  say: 0.20,          // and how much of one is worth telling the HUD about
  /* Where on that noise the run starts, chosen rather than found — exactly
     as `START_TOD` is, and for exactly the same reason. It cannot change the
     odds, which belong to the noise: sixty hours from here is the same one
     night in four it was from zero. What it changes is the only part of the
     sequence anyone ever sees. From an offset of nothing the first five
     nights were blank and the first display was half an hour into the run,
     which for most people is a feature that does not exist. From here the
     first night has nothing on it, the second has all of one, and the third
     and fourth have nothing again — which is the same rarity, met inside the
     time somebody actually rides. */
  offset: 1300,
};

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const ramp = (v, a, b) => smooth(Math.min(1, Math.max(0, (v - a) / (b - a))));

export function createWeather(THREE) {
  // Colour objects are allocated once and mutated; this runs every frame
  const keys = PHASES.map((p) => ({
    ...p,
    cZenith: new THREE.Color(p.zenith),
    cMid: new THREE.Color(p.mid),
    cHorizon: new THREE.Color(p.horizon),
    cHaze: new THREE.Color(p.haze),
    cKey: new THREE.Color(p.key),
    cGlow: new THREE.Color(p.glow),
  }));

  const state = {
    tod: START_TOD,
    storm: 0.18,
    phase: 'MORNING',
    conditions: 'LIGHT SNOW',
    zenith: new THREE.Color(),
    mid: new THREE.Color(),
    horizon: new THREE.Color(),
    haze: new THREE.Color(),
    key: new THREE.Color(),
    glow: new THREE.Color(),
    keyI: 1.38,
    hemiI: 1,
    elevation: 0.3,
    azimuth: 2.35,
    star: 0,
    moon: 0,
    fogNear: RENDER.fogNear,
    fogFar: RENDER.fogFar,
    snow: 0.3,
    windX: 0,
    windZ: 0,
    night: 0,
    aurora: 0,
  };

  const stormTint = new THREE.Color();
  let clock = 0;
  let frozen = null;   // a fixed time of day, if the player has pinned one

  function sample(tod) {
    // Find the pair of moments this time falls between, wrapping the table
    let i = keys.length - 1;
    for (let k = 0; k < keys.length; k++) if (tod >= keys[k].at) i = k;
    const a = keys[i];
    const b = keys[(i + 1) % keys.length];
    const span = (b.at <= a.at ? b.at + 1 : b.at) - a.at;
    const t = smooth(Math.min(1, Math.max(0, (tod - a.at) / span)));

    state.zenith.copy(a.cZenith).lerp(b.cZenith, t);
    state.mid.copy(a.cMid).lerp(b.cMid, t);
    state.horizon.copy(a.cHorizon).lerp(b.cHorizon, t);
    state.haze.copy(a.cHaze).lerp(b.cHaze, t);
    state.key.copy(a.cKey).lerp(b.cKey, t);
    state.glow.copy(a.cGlow).lerp(b.cGlow, t);
    state.keyI = lerp(a.keyI, b.keyI, t);
    state.hemiI = lerp(a.hemiI, b.hemiI, t);
    state.elevation = lerp(a.elevation, b.elevation, t);
    state.star = lerp(a.star, b.star, t);
    state.moon = lerp(a.moon, b.moon, t);
    state.phase = t < 0.5 ? a.name : b.name;
  }

  function update(dt) {
    clock += dt;
    if (frozen === null) {
      state.tod = (START_TOD + clock / DAY_SECONDS) % 1;
    } else {
      state.tod = frozen;
    }
    sample(state.tod);
    state.night = Math.max(state.star, state.moon);

    /* Weather drifts on its own clock, over the whole range it has.

       Two octaves of value noise summed and then pulled apart, and the
       pulling apart is the part that matters. The sum of two noise fields is
       far more centrally distributed than either — it spends nearly all of
       its time within a fifth of its own mean and essentially never reaches
       either end. Fed straight in, that gave a mountain whose weather was
       permanently somewhere between SNOWING and HEAVY SNOW: never actually
       clear, and never actually a blizzard, so the five bands the game can
       describe were three bands it ever used.

       So the mid-range is stretched across the whole scale and the ends are
       allowed to clip. Clipping is not a defect here, it is the mechanism:
       the flat stretches at 0 and 1 are the hours of genuinely clear air and
       the whiteouts you have to steer through, and the noise decides how
       long each of them lasts. The exponent keeps clear weather a little
       more common than a blizzard, because it should be. */
    const raw = (noise2(clock / STORM_PERIOD, 0.5, 91) * 0.65
      + noise2(clock / (STORM_PERIOD * 3.7), 4.5, 17) * 0.5) / 1.15;
    /* Centred low, then stretched.

       Widening the distribution without moving it down was half a fix and
       looked worse than the bug: the noise sits around 0.55, so mapping that
       to the middle of the scale left the mountain permanently at HEAVY
       SNOW, which pulls every colour towards the haze and washed the whole
       picture out to cream. Clear air has to be the common case — it is the
       only condition in which the sky is blue, the snow is white and the sun
       is visible, which is to say the only condition the game looks like
       itself in. The centre now lands at 0.28, the exponent pushes the bulk
       lower still, and the stretch is what lets the tail reach a genuine
       whiteout every few minutes. */
    const spread = Math.min(1, Math.max(0, (raw - 0.55) * 2.9 + 0.32));
    state.storm = Math.pow(spread, 1.7);
    const s = state.storm;

    /* The aurora, on the same shape of clock as the storm and cut higher up
       it. Two octaves rather than one, because a single one gives every
       display the same arc: the quick one decides what happens inside a
       night and the slow one decides whether this is a week the mountain
       gets any at all. The slow one used to be five times the period, which
       is longer than anyone rides in one sitting — whichever side of it you
       started on was the whole of your experience of the aurora, and half of
       players would have had none. It is now short enough that the weather
       can turn while you are still on the hill.

       The storm takes it exactly as it takes the stars, and for the same
       reason: cloud is cloud, and it does not care how big the thing behind
       it is. This was squared for a while, on the theory that a faint sheet
       needs clearer air than a point of light does, which is not true and
       which — against a storm dial whose median sits at 0.43 — quietly cut
       the whole feature by two thirds. */
    const auroraClock = clock + AURORA.offset;
    const lit = noise2(auroraClock / AURORA.period, 3.5, 137) * 0.70
      + noise2(auroraClock / (AURORA.period * 2.4), 8.5, 138) * 0.45;
    state.aurora = ramp(lit, AURORA.from, AURORA.to)
      * ramp(state.night, AURORA.night[0], AURORA.night[1])
      * (1 - s);

    for (const b of BANDS) {
      if (s < b.to) { state.conditions = b.name; break; }
    }
    // Layered over the bands rather than replacing them, because the two are
    // answering different questions and a display can happen in light snow.
    // It does take CLEAR's place, though: on the one night in four that this
    // fires, "clear" is a considerable understatement.
    if (state.aurora > AURORA.say) {
      state.conditions = state.conditions === 'CLEAR'
        ? 'AURORA' : `${state.conditions} · AURORA`;
    }

    // A storm pulls the whole sky towards the haze and brings the haze in.
    // Doing it as one move over the day table is what keeps a blizzard at
    // dusk looking like dusk.
    stormTint.copy(state.haze);
    const pull = s * 0.78;
    state.zenith.lerp(stormTint, pull * 0.85);
    state.mid.lerp(stormTint, pull);
    state.horizon.lerp(stormTint, pull);
    state.glow.lerp(stormTint, pull);
    state.keyI *= 1 - 0.6 * s;
    state.hemiI *= 1 - 0.25 * s;

    // Clear air is whatever the renderer's draw distance currently is, so
    // the curtain moves when that number moves. Both ends of the storm are
    // absolute: a whiteout is seventy metres of visibility whether the
    // engine is drawing three hundred or four.
    state.fogNear = lerp(RENDER.fogNear, 10, s * s);
    state.fogFar = lerp(RENDER.fogFar, 68, Math.pow(s, 0.85));
    state.snow = 0.12 + s * 0.88;
    // Wind swings slowly, and hard, once there is enough weather to carry it
    const swing = noise2(clock / 23, 9.5, 5) * 2 - 1;
    state.windX = swing * (1.5 + s * 16);
    state.windZ = (noise2(clock / 31, 2.5, 6) * 2 - 1) * (1 + s * 6);
    // The sun crosses the run rather than sitting behind it. Side light is
    // the only light that shapes snow: from behind, a mogul field is a flat
    // white sheet with the fill light's colour on it, which is exactly what
    // this looked like before the azimuth was moved round.
    state.azimuth = 1.15 + Math.sin(state.tod * Math.PI * 2) * 0.8;
    return state;
  }

  /* For the pause menu: pin the sky, or let it run again. */
  function pin(tod) {
    frozen = tod;
  }
  function release() {
    frozen = null;
    clock = state.tod < START_TOD
      ? (1 + state.tod - START_TOD) * DAY_SECONDS
      : (state.tod - START_TOD) * DAY_SECONDS;
  }

  update(0);
  return { state, update, pin, release };
}
