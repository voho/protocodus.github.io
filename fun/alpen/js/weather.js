/* Time of day, and what the sky is doing.

   Two dials, both continuous, and nothing in the game reads a preset name
   except the HUD.

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
   pulls every colour towards the haze, brings the fog in from three hundred
   metres to seventy, takes half the light out, and turns the snowfall from
   a few flakes into something you steer through. A blizzard at dusk and a
   blizzard at noon are recognisably the same weather and completely
   different places, which is the whole reason to have two dials instead of
   a list of six skies.

   The one liberty taken with the sun: at night it is the moon, and it is
   allowed to be far brighter than the real one, because a mountain you
   cannot see is not a mountain you can ride. */

import { noise2 } from './noise.js';

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
  {
    at: 0.28, name: 'MORNING',
    zenith: '#1b3f86', mid: '#6f9ad6', horizon: '#e3e9f1', haze: '#dce5f0',
    key: '#fff2d8', glow: '#ffdcae', keyI: 3.45, hemiI: 1.3,
    elevation: 0.30, star: 0, moon: 0,
  },
  {
    at: 0.48, name: 'DAY',
    zenith: '#123a7a', mid: '#74a3de', horizon: '#eaf0f8', haze: '#e3ecf6',
    key: '#fffaf0', glow: '#ffeccc', keyI: 4.0, hemiI: 1.5,
    elevation: 0.62, star: 0, moon: 0,
  },
  {
    at: 0.68, name: 'GOLDEN HOUR',
    zenith: '#1c3a72', mid: '#82a0cc', horizon: '#f7d9a5', haze: '#e7d9c3',
    key: '#ffd49a', glow: '#ffb060', keyI: 3.59, hemiI: 1.15,
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

const DAY_SECONDS = 360;
const START_TOD = 0.34;      // a bright morning, so the first look is the best one
const STORM_PERIOD = 52;     // seconds per unit of the noise that drives it

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

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
    fogNear: 85,
    fogFar: 300,
    snow: 0.3,
    windX: 0,
    windZ: 0,
    night: 0,
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

    // Weather drifts on its own clock, biased low so clear air is the
    // common case and a whiteout is something that arrives
    const raw = noise2(clock / STORM_PERIOD, 0.5, 91) * 0.65
      + noise2(clock / (STORM_PERIOD * 3.7), 4.5, 17) * 0.5;
    state.storm = Math.min(1, Math.max(0, Math.pow(Math.min(1, raw), 1.55)));
    const s = state.storm;

    for (const b of BANDS) {
      if (s < b.to) { state.conditions = b.name; break; }
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

    state.fogNear = lerp(85, 10, s * s);
    state.fogFar = lerp(300, 68, Math.pow(s, 0.85));
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
    state.night = Math.max(state.star, state.moon);
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
