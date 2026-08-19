/* Time of day, and what the sky is doing.

   Four dials now, all continuous, and nothing in the game reads a preset
   name except the HUD.

   `tod` runs a full day in three minutes of riding. It is interpolated
   through a table of nine moments and every one of them carries the whole
   picture: the three stops of the sky gradient, the colour of the haze, the
   colour and strength of the key light, how high it sits, and how much of
   the star field shows through. Because the table is interpolated rather
   than switched, there is no moment at which the sky changes; there is only
   ever a sky that has been changing.

   Two of those nine are new and they are the two the day was missing. The
   old table went from a black night straight to an orange dawn and from an
   orange dusk straight back to a black night, so the run never once passed
   through the hour every photograph of this sport is actually taken in: the
   cold one, after the sun has gone and before the sky has. FIRST LIGHT and
   BLUE HOUR are that hour on each side — no warmth anywhere in the frame, a
   violet zenith, a dark violet valley, and a key light that is barely more
   than the sky itself. They are also the only two moments where the sun is
   allowed *under* the horizon, which is what makes them work: the disc sets,
   the alpenglow goes out, the rays stop, and what is left is a mountain lit
   by nothing but the air over it.

   Everything else in the table was pushed the same way the daylight moments
   were pushed before it — deeper at the top, more saturated at the horizon,
   and further apart from its neighbours. The one thing that could not be
   touched is the *shape* of the gradient, because `shading.js` carries a
   transcription of the dome's own shader so that a fogged ridge dissolves
   into the same sky it is standing in front of. Both ends read these
   numbers, so the numbers are where a day's worth of variation has to come
   from, and they carry it perfectly well.

   `storm` drifts on slow noise between clear air and a whiteout. It is not
   a separate weather system so much as a second axis over the first: it
   pulls every colour towards the haze, brings the fog in from four hundred
   metres to seventy, takes half the light out, and turns the snowfall from
   a few flakes into something you steer through. A blizzard at dusk and a
   blizzard at noon are recognisably the same weather and completely
   different places, which is the whole reason to have two dials instead of
   a list of six skies.

   `mist` is the third, and it is the one dial that is a fact about the air
   rather than about the sky. It says how much layered cloud there is at the
   moment; `sky.js` decides what that looks like and at what altitude, which
   is the same split the aurora already has. What is worth recording here is
   what it is multiplied by, because mist is the one weather in the game that
   does *not* simply follow the storm.

   It is a cold-air phenomenon. Valley fog forms overnight and burns off as
   the sun gets high enough to warm the ground, so the diurnal term is the
   sun's own elevation — and it has to be told that the thing in the sky at
   two in the morning is the moon, or a moon riding at twenty-five degrees
   burns off the fog that only exists because it is night. Hence the
   `1 - moon` on it: at night the sun is nowhere and the air stays cold.

   And the storm term is a hump rather than a slope. A little weather makes
   more mist, which is right; a whiteout makes none, which looks wrong
   written down and is exactly right in the picture, because at seventy
   metres of visibility the storm's own fog has already eaten everything the
   mist would have said and all a layer can do is cost fill rate. So mist
   peaks in the middle of the storm dial and is gone at the top of it.

   `aurora` is the fourth, and it is zero on most nights by construction. It
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

import { noise2, hash2 } from './noise.js';
import { RENDER } from './config.js';

/* Nine moments, and one rule underneath all of them: the amber lives at the
   horizon and nowhere else. Every zenith in this table is a blue, every haze
   is a blue or a violet or — for the two hours either side of the sun going
   down — a dusty rose that is still cooler than the light causing it. Snow
   takes the colour of what is over it, so a warm mid stop is a warm mountain,
   and a warm mountain is a beige one.

   `elevation` is the one field that does something structural. It is where
   the light is coming from, and everything downstream reads it: the disc, the
   glow, the alpenglow on the ranges, the crepuscular pass, and whether the
   sun is throwing a shadow at all. Two of the moments now put it under zero,
   which is new — see the note at the head of the file. */
const PHASES = [
  {
    at: 0.00, name: 'NIGHT',
    zenith: '#02060f', mid: '#08172f', horizon: '#16274a', haze: '#1a2a48',
    key: '#a8c0e8', glow: '#6f8cc0', keyI: 0.76, hemiI: 0.55,
    elevation: 0.46, star: 1, moon: 1,
  },
  /* The cold hour before the warm one. There is no orange anywhere in this
     line and that is the whole point of it: the sun is still under the
     horizon, so what is lighting the mountain is the sky, the sky is lit from
     below and behind, and the only colour in the frame is the blue-grey the
     air itself is. It is the hour the Belt of Venus stands in — see `BELT` in
     `sky.js`, which reads the elevation below and nothing else. */
  {
    at: 0.09, name: 'FIRST LIGHT',
    zenith: '#0b1730', mid: '#294164', horizon: '#758aa2', haze: '#4d5e74',
    key: '#9cb7d4', glow: '#829db9', keyI: 0.90, hemiI: 0.68,
    elevation: -0.03, star: 0.55, moon: 0.42,
  },
  {
    at: 0.17, name: 'DAWN',
    zenith: '#1a315f', mid: '#566f9f', horizon: '#dba280', haze: '#a9a0a0',
    key: '#efb792', glow: '#e99968', keyI: 1.85, hemiI: 0.98,
    elevation: 0.05, star: 0.16, moon: 0.10,
  },
  /* The three daylight moments carry the whole look. They keep the clear,
     high-altitude blue without asking the grade to hold a near-black cobalt
     zenith beside a clipped warm-white slope.

     A real alpine sky at altitude is not pale — there is a third less
     atmosphere over it than at sea level, so the zenith remains deep and the
     horizon remains bright. The stops are closer in chroma, however, and the
     hemisphere carries more of the exposure. Snow shadows therefore stay
     visibly cool while retaining structure, and sun-facing walls have room
     for detail instead of arriving at the shoulder already warm and white.

     Morning and day are also no longer nearly the same sky. A morning is
     cooler and a shade less contrasty than a noon — the sun is lower, there
     is more air in the way of it, and the haze has not burnt off — so the
     morning's key keeps a trace of the dawn it just came out of and its
     zenith stops short of the noon's navy. */
  {
    at: 0.30, name: 'MORNING',
    zenith: '#164176', mid: '#527ead', horizon: '#d9e4ee', haze: '#d1dce6',
    key: '#f6eee2', glow: '#efd4ad', keyI: 3.25, hemiI: 1.16,
    elevation: 0.30, star: 0, moon: 0,
  },
  {
    at: 0.48, name: 'DAY',
    zenith: '#12396c', mid: '#4675a7', horizon: '#dce7f1', haze: '#d7e2ec',
    key: '#f8f5ee', glow: '#ede1ce', keyI: 3.65, hemiI: 1.24,
    elevation: 0.62, star: 0, moon: 0,
  },
  {
    at: 0.66, name: 'GOLDEN HOUR',
    zenith: '#263b70', mid: '#6d8eba', horizon: '#e9c997', haze: '#cbbda8',
    key: '#f2c492', glow: '#e3a061', keyI: 3.15, hemiI: 1.05,
    elevation: 0.20, star: 0, moon: 0,
  },
  {
    at: 0.79, name: 'DUSK',
    zenith: '#20294d', mid: '#536080', horizon: '#ae857b', haze: '#747780',
    key: '#d5a08b', glow: '#c67965', keyI: 1.42, hemiI: 0.92,
    elevation: 0.035, star: 0.30, moon: 0.24,
  },
  /* And the other side of it. The haze here is the darkest in the table and
     it is darker than the sky above it on purpose: the valley goes out well
     before the dome does, which is the single most recognisable thing about
     a mountain at this hour and the reason the ranges read as ranges. */
  {
    at: 0.86, name: 'BLUE HOUR',
    zenith: '#121a38', mid: '#354465', horizon: '#817c8e', haze: '#505260',
    key: '#a6adc1', glow: '#8e93a7', keyI: 0.93, hemiI: 0.72,
    elevation: -0.045, star: 0.55, moon: 0.35,
  },
  {
    at: 0.95, name: 'NIGHTFALL',
    zenith: '#040a1c', mid: '#0e2043', horizon: '#223257', haze: '#1d2e4e',
    key: '#9db5df', glow: '#6b88bd', keyI: 0.83, hemiI: 0.55,
    elevation: 0.40, star: 0.9, moon: 0.95,
  },
];

/* IT IS ALWAYS SNOWING. CLEAR came off this list, and with it the idea that
   the dial's bottom end is an absence of weather.

   The band names are only labels, but they were honest ones: the bottom of
   the storm dial genuinely was nothing falling at all, and a mountain with
   nothing falling on it is a postcard. What the run wants is the other thing
   the Alps do constantly — a sky that is never quite finished, from a few
   flakes drifting through the headlamp to a whiteout you steer by feel. So
   the scale now runs from a light fall to a blizzard, and the floor under
   `state.snow` further down is what makes the label true rather than
   decorative. */
const BANDS = [
  { to: 0.045, name: 'CLEAR' },
  { to: 0.16, name: 'FLURRIES' },
  { to: 0.36, name: 'LIGHT SNOW' },
  { to: 0.60, name: 'SNOWING' },
  { to: 0.81, name: 'HEAVY SNOW' },
  { to: 1.01, name: 'BLIZZARD' },
];

/* How long everything takes.

   The day is intentionally compressed to three minutes: five times the
   original fifteen-minute cycle, so every run gets daylight, blue hour and
   the headlamp-lit night without a long wait. The phase table still blends
   continuously, so the faster clock never becomes a sequence of switches.

   It was ninety seconds for one release, and ninety seconds is where the
   trick collapses. The table's shortest chapters — dusk into blue hour is
   seven hundredths of the day — last six seconds at that rate, the sun
   visibly slides, and the kilometre-scale mountain shadows march across the
   piste while you watch. A compressed day only works while each hour is
   still longer than the glance that takes it in; three minutes is the
   fastest clock that keeps that true. */
const DAY_SECONDS = 180;
const START_TOD = 0.34;      // a bright morning, so the first look is the best one
const STORM_PERIOD = 110;    // seconds per unit of the noise that drives it
/* And the whole weather clock runs at this multiple of real time.

   One dial rather than five. The storm, the mist, the aurora, the cloud deck
   and the lightning cells are all read off `weatherClock` at periods that
   were chosen against each other — the mist deliberately slower than the
   storm, the aurora slower again — so scaling the clock keeps every one of
   those ratios exactly as it was and simply runs the whole system faster.
   Halving five periods by hand would not: it is five chances to get one of
   them wrong, and the next person to add a sixth would have no way of
   knowing they had joined a convention.

   It sits at one, which is not the same as not existing. The doubled clock
   shipped alongside the ninety-second day and failed the same way: the fog
   distance rides the storm dial, so a front every half minute is a horizon
   that visibly breathes in and out. At real time a front takes a couple of
   minutes to arrive, which is long enough to watch it coming — and the
   called storms (`triggerStorm`) now guarantee the drama the fast clock was
   trying to buy. */
const WEATHER_RATE = 1;
/* The quietest the sky is allowed to get IN AN UNSETTLED AIRMASS. See
   `BANDS`: while a front is anywhere in the region the run is never without
   falling snow, so the dial's bottom is a light fall rather than clear air.
   Small enough that a calm minute still looks calm. */
const STORM_FLOOR = 0.085;

/* THE AIRMASS, which is the weather above the weather.

   Two comments in this file used to disagree with each other. One said the
   run is never without falling snow and put a floor under the dial; the
   other said clear air has to be the common case, because it is the only
   condition in which the sky is blue, the snow is white and the sun is
   visible — the only condition the game looks like itself in. Both are
   right, and they are right about different timescales: a front brings its
   own permanent flurries for as long as it is in the region, and then it
   leaves and the range sits under a high for a day.

   So the storm dial no longer runs between fixed ends. A much slower clock
   than the storm's decides what kind of airmass this stretch of hours is,
   and the dial's floor AND ceiling ride it: settled air drops the floor to
   nothing — genuine blue-sky alpine cold, full draw distance, no flakes at
   all — and holds the ceiling down where a blizzard cannot reach. Unsettled
   air lifts the floor back to a light fall and opens the ceiling to a real
   whiteout. The tail of each is still decided by the storm noise, so what
   the airmass changes is the odds, never the shape.

   `period` is deliberately several times the storm's: a front should pass
   through an airmass, not the other way round. The band is wide, so most of
   the clock is spent committed to one kind of weather rather than between
   two. Called storms (`triggerStorm`) ignore all of this by construction —
   they `max` over the dial — so a settled sky can still be interrupted on
   demand. */
const AIRMASS = {
  period: 430,
  seed: 613,
  /* Cut a little below where the noise sits, so the range spends more of
     its time under an unsettled airmass than a settled one. A settled
     spell should be the good weather you ride out to, not the default. */
  band: [0.30, 0.58],
  // floor and ceiling at each end: [settled, unsettled]
  floor: [0, STORM_FLOOR],
  /* Settled air still gets its afternoon flurry — the ceiling is where a
     light snow starts, not where clear air ends — and unsettled air is
     uncapped, so the tail of the storm noise still reaches a whiteout. */
  ceiling: [0.42, 1],
};

/* THE GUST, which is what wind on a mountain actually is.

   The swing below was one slow noise: a wind that changed direction over
   half a minute and never did anything in between. Real alpine wind is a
   lull and then a blast — the flakes hang, then they go sideways, the
   spruces lash, and a rider in the air feels a shove they did not ask for
   (see `RIDER.windAir`). That texture is entirely in the envelope, so it is
   one more noise on a fast clock multiplying the swing rather than a second
   wind with a direction of its own.

   `floor` is what survives between gusts, so a gusty minute is not a
   stroboscopic one, and the whole envelope stiffens with the storm: a
   blizzard is not a series of gusts, it is a continuous blast. */
const GUST = {
  period: 6.5,
  seed: 733,
  floor: 0.34,
  reach: 2.1,
  /* The raw field is two octaves of value noise and spends its life near
     the middle of its range; taken straight it gives a gust that breathes
     rather than one that hits. This stretches the middle out to the ends
     before the envelope shapes it. */
  band: [0.34, 0.70],
};

/* How fast the horizon is allowed to move, in metres of draw distance per
   second.

   `fogFar` used to be a pure function of the storm dial, and the file said
   so: a dial on a slow noise is still a continuously moving curtain, and
   the horizon visibly breathed in and out. Rate-limiting it means the fog
   answers a front rather than tracking it — a whiteout still closes in over
   a few seconds, which is what a squall does, but ordinary drift in the
   dial no longer moves the far distance at all. Near fog is limited to a
   share of it, because the near curtain is small and a slow one reads as
   lag rather than as weather. */
const FOG_RATE = 120;
/* Menu/debug time presets are camera moves through the day, not cuts.  This
   rate takes roughly five seconds to settle after a large request, slow
   enough that the sun, fog line and kilometer-scale mountain shadows travel
   instead of visibly stepping between poses. */
const PIN_RATE = 0.85;

/* The mist, in four numbers and a hump.

   `period` is slower than the storm's and much slower than the aurora's,
   because a bank of cloud lying in a valley is the most inert weather there
   is: it forms overnight, it sits, and it goes when the sun reaches it. At
   three minutes to the unit a bank takes about a minute to build and the
   rider descends four hundred metres of mountain inside one, which is what
   makes it read as a place rather than as an effect.

   `from` and `to` are where that noise is cut, and they are cut low. This is
   the opposite decision to the aurora's: an aurora has to be rare or it is a
   green sky, and mist has to be *common* or the layers never turn up in the
   ten minutes anybody actually rides. Something like two thirds of the clock
   is over `from`, and the diurnal term below is what turns that into a thing
   that happens at dawn and at night rather than a permanent fixture. */
const MIST = {
  period: 175,
  from: 0.30,
  to: 0.76,
  say: 0.34,          // and how much of it is worth telling the HUD about
};

/* The aurora, in five numbers.

   `period` is long against the three-minute day on purpose: the display has to
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

/* The cloud deck overhead, in six numbers.

   `fair` and `storm` are the two halves of it. Fair-weather cloud is the slow
   build-and-clear of an ordinary mountain day and it never amounts to much —
   scattered cumulus, holes everywhere, the sun in and out. Storm cloud is the
   lid, and it arrives with everything else the dial brings. They add, and the
   sum is capped well under one so that even a blizzard's sky keeps some blue
   in it, which is both what the palette needs and what an alpine overcast
   genuinely looks like from up here.

   `drift` converts a surface-wind metre into the deck's noise-cell phase. The
   broad ground-shadow octave is four cells across 560 metres, or 140 metres
   per cell; taking one tenth of the surface wind and dividing by that cell
   span puts the visible deck and its shadow pools on the same slow clock. */
const CLOUD = {
  period: 205,
  from: 0.34,
  to: 0.78,
  fair: 0.55,
  storm: 0.5,
  max: 0.8,
  drift: 0.10 / 140,
};

/* Lightning, in three numbers, and only inside a real whiteout.

   The trigger is not a die roll. The clock is cut into half-second cells,
   each cell hashes its own index — the same seeded hash the mountain is
   built from, so a shared seed replays its storms strike for strike — and
   the one-in-twenty that clear the threshold flash. Everything after the
   trigger is a pure function of how far into its cell the clock is, so the
   decay needs no state, no accumulator and no `Math.random` anywhere: ask
   the same second twice and it answers the same. A cell is long against the
   decay, which is what keeps a strike from leaking into the cell after it,
   and `chance` works out to a flash every ten seconds or so of blizzard —
   rare enough to startle, which is the entire job of lightning.

   `sky.js` decides what a flash looks like; this end only says when. */
const FLASH = {
  rate: 2,          // trigger cells per second of clock
  chance: 0.05,     // the odds any one cell strikes
  decay: 0.15,      // seconds for a strike to fall to 1/e
};

/* A near-full-screen white strobe is exactly the class of motion the
   preference exists for. Gated at the trigger so both consumers — the dome
   colours and the hemisphere pulse — go quiet together; the seeded clock
   hash is untouched, so everyone else's storms still replay identically. */
const CALM = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
// A step towards a target, bounded in magnitude. See `FOG_RATE`.
const clampAbs = (v, m) => (v > m ? m : v < -m ? -m : v);
/* Into the deck's own repeat. The noise field wraps at 64, so this is the same
   sample and not an approximation of it — see the drift note in `update`. */
const wrap64 = (v) => v - Math.floor(v / 64) * 64;
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
    // 0 = a settled high over the range, 1 = an unsettled front-bearing
    // airmass. See `AIRMASS`; it sets both ends of the storm dial.
    airmass: 1,
    gust: 1,
    night: 0,
    aurora: 0,
    mist: 0,
    flash: 0,
    // The deck overhead, and where the wind has pushed it. See `CLOUD` and the
    // long note on `n64Deck` in shading.js.
    cloud: 0,
    cloudX: 0,
    cloudZ: 0,
  };

  const stormTint = new THREE.Color();
  const neutralStormTint = new THREE.Color();
  /* Daylight can be pinned by the pause/debug surface; weather cannot. These
     used to share one clock, and `release` rewound that clock to reconstruct
     the chosen time of day — instantly teleporting the storm, wind, mist,
     cloud deck and lightning schedule as collateral damage. Independent
     monotonic clocks make pinning a sky exactly the local operation it says
     it is. */
  let dayClock = 0;
  let weatherClock = 0;
  let fogSettled = false;   // see FOG_RATE: the first frame takes its target whole
  let frozen = null;   // target time of day, if the player has pinned one
  let pinnedTod = START_TOD;
  /* A called storm is a front, not a switch.

     `triggerStorm` used to write 1.0 straight into the override, which is a
     whiteout in a single frame: the fog wall teleporting from four hundred
     metres to seventy, every colour snapping to the haze, the snowfall going
     from flurries to blizzard between one frame and the next. Weather never
     does that, and on screen it read as a glitch rather than a storm.

     The call now only opens the front. The override climbs to the whiteout
     over `STORM_ATTACK` seconds — long enough to watch it coming, which is
     the entire drama of a front — holds it for `STORM_HOLD`, and hands back
     to the ambient dial over `STORM_RELEASE`. Both corners go through
     `smooth`, so the fog distance never changes direction with a kink. A
     call while a front is already on the mountain is ignored rather than
     stacked: one storm at a time is a readability rule, not meteorology. */
  let stormCalled = -1;      // seconds since the front was called; <0 = none
  const STORM_ATTACK = 12;
  const STORM_HOLD = 16;
  const STORM_RELEASE = 14;

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
    dayClock += dt;
    weatherClock += dt * WEATHER_RATE;
    if (frozen === null) {
      state.tod = (START_TOD + dayClock / DAY_SECONDS) % 1;
    } else {
      // Debug/pause presets are still environment changes. Travel the shortest
      // way around the day ring instead of teleporting every sky/light uniform.
      let delta = frozen - pinnedTod;
      if (delta > 0.5) delta -= 1;
      if (delta < -0.5) delta += 1;
      pinnedTod = (pinnedTod + delta * (1 - Math.exp(-PIN_RATE * dt)) + 1) % 1;
      state.tod = pinnedTod;
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
    const raw = (noise2(weatherClock / STORM_PERIOD, 0.5, 91) * 0.65
      + noise2(weatherClock / (STORM_PERIOD * 3.7), 4.5, 17) * 0.5) / 1.15;
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
    /* …and a floor under it, which is what "always snowing" means in the one
       place it has to mean something.

       The exponent still keeps the light end far more common than the heavy
       one — that has not changed and should not, because the storm pulls
       every colour towards the haze and a mountain permanently at HEAVY SNOW
       washes out to cream. What has changed is that the light end is no
       longer nothing. A twelfth of the dial is enough to keep flakes in the
       air, the fog a little in, and the snow underfoot a shade softer,
       without touching how the picture reads on a quiet day. */
    /* The airmass sets both ends of the dial. `unsettled` is the same
       smoothstep-over-a-band shape the terrain's chapters use, so the range
       spends its time committed to one kind of sky rather than sliding
       between two, and `state.airmass` is published for anything that wants
       to know which it is in. */
    const airRaw = noise2(weatherClock / AIRMASS.period, 7.5, AIRMASS.seed);
    const unsettled = smooth(Math.min(1, Math.max(0,
      (airRaw - AIRMASS.band[0]) / (AIRMASS.band[1] - AIRMASS.band[0]))));
    state.airmass = unsettled;
    const floor = lerp(AIRMASS.floor[0], AIRMASS.floor[1], unsettled);
    const ceiling = lerp(AIRMASS.ceiling[0], AIRMASS.ceiling[1], unsettled);
    state.storm = floor + (ceiling - floor) * Math.pow(spread, 1.7);
    if (stormCalled >= 0) {
      stormCalled += dt;
      const t = stormCalled;
      let front = 0;
      if (t < STORM_ATTACK) {
        front = smooth(t / STORM_ATTACK);
      } else if (t < STORM_ATTACK + STORM_HOLD) {
        front = 1;
      } else if (t < STORM_ATTACK + STORM_HOLD + STORM_RELEASE) {
        front = 1 - smooth((t - STORM_ATTACK - STORM_HOLD) / STORM_RELEASE);
      } else {
        stormCalled = -1;
      }
      // `max`, so a called front can only ever add to whatever the ambient
      // dial was already doing — never carve a hole in a natural blizzard.
      state.storm = Math.max(state.storm, front);
    }
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
    /* The mist, on its own slow clock and then multiplied by two things that
       have nothing to do with each other.

       The diurnal term is the sun's elevation, held off at night by the moon
       — the state carries one elevation for whatever is currently up there,
       so without the `1 - moon` a bright moon at twenty-five degrees would
       burn off the fog that only exists because it is dark. Four fifths is
       the most it is allowed to take, so a noon bank is thin rather than
       impossible: a summer inversion can sit in a valley all day.

       The storm term is the hump described at the head of the file. A little
       weather thickens the air; a whiteout replaces it, because at seventy
       metres of visibility a layer at altitude has nothing left to say and
       still costs everything to draw. */
    const damp = noise2(weatherClock / MIST.period, 6.5, 211) * 0.72
      + noise2(weatherClock / (MIST.period * 2.9), 1.5, 212) * 0.42;
    const cold = 1 - 0.80 * ramp(state.elevation, 0.08, 0.46) * (1 - state.moon);
    state.mist = Math.min(1, ramp(damp, MIST.from, MIST.to) * cold
      * (0.75 + 0.55 * s) * (1 - ramp(s, 0.52, 0.90)));

    const auroraClock = weatherClock + AURORA.offset;
    const lit = noise2(auroraClock / AURORA.period, 3.5, 137) * 0.70
      + noise2(auroraClock / (AURORA.period * 2.4), 8.5, 138) * 0.45;
    state.aurora = ramp(lit, AURORA.from, AURORA.to)
      * ramp(state.night, AURORA.night[0], AURORA.night[1])
      * (1 - s);

    for (const b of BANDS) {
      if (s < b.to) { state.conditions = b.name; break; }
    }
    /* Layered over the bands rather than replacing them, because the two are
       answering different questions and a display can happen in light snow.
       It does take CLEAR's place, though: on the one night in four that this
       fires, "clear" is a considerable understatement.

       Mist gets the same treatment and never both, which is a decision about
       the width of a HUD label rather than about the weather — the two can
       perfectly well happen at once, and when they do the aurora is the
       rarer news. It is also only said in air that is otherwise quiet: a bank
       of fog announced in the middle of a blizzard is not information. */
    if (state.aurora > AURORA.say) {
      /* The quietest band is the one that used to be CLEAR, and these two
         tested for that name. Testing the *dial* instead says the same thing
         and cannot go stale the next time the labels move: below the first
         band the sky is as quiet as this mountain gets, and a lone AURORA or
         MIST is the more useful headline than "flurries, and also an
         aurora". */
      state.conditions = s < BANDS[0].to
        ? 'AURORA' : `${state.conditions} · AURORA`;
    } else if (state.mist > MIST.say && s < BANDS[2].to) {
      state.conditions = s < BANDS[0].to
        ? 'MIST' : `${state.conditions} · MIST`;
    }

    /* A storm pulls the whole sky towards the haze and brings the haze in.
       As it becomes a whiteout, the haze is progressively neutralised at its
       existing luminance rather than replaced by one fixed grey. That keeps
       night storms dark and day storms bright while preventing dusk's warm
       haze and key from turning snow, fog and every mountain face magenta. */
    stormTint.copy(state.haze);
    const stormLuma = stormTint.r * 0.2126
      + stormTint.g * 0.7152 + stormTint.b * 0.0722;
    neutralStormTint.setRGB(
      stormLuma * 0.92,
      stormLuma * 0.99,
      Math.min(1, stormLuma * 1.08),
    );
    stormTint.lerp(neutralStormTint, ramp(s, 0.12, 0.90) * 0.9);
    const pull = s * 0.78;
    state.haze.lerp(stormTint, ramp(s, 0.25, 0.95) * 0.88);
    state.zenith.lerp(stormTint, pull * 0.85);
    state.mid.lerp(stormTint, pull);
    state.horizon.lerp(stormTint, pull);
    state.glow.lerp(stormTint, pull);
    state.key.lerp(stormTint, pull * 0.90);
    state.keyI *= 1 - 0.6 * s;
    state.hemiI *= 1 - 0.25 * s;

    // Clear air is whatever the renderer's draw distance currently is, so
    // the curtain moves when that number moves. Both ends of the storm are
    // absolute: a whiteout is seventy metres of visibility whether the
    // engine is drawing three hundred or four.
    const wantNear = lerp(RENDER.fogNear, 10, s * s);
    const wantFar = lerp(RENDER.fogFar, 68, Math.pow(s, 0.85));
    // Rate-limited rather than assigned: see `FOG_RATE`. The first frame
    // takes the target whole, so a fresh run opens on the sky it should.
    if (!fogSettled) {
      state.fogNear = wantNear;
      state.fogFar = wantFar;
      fogSettled = true;
    } else {
      const step = FOG_RATE * dt;
      state.fogFar += clampAbs(wantFar - state.fogFar, step);
      state.fogNear += clampAbs(wantNear - state.fogNear, step * 0.35);
    }
    /* Falling snow follows the dial the whole way down now. The old 0.12
       floor was the always-snowing rule wearing a different hat, and under
       a settled airmass it was the one thing left contradicting a blue
       sky — flakes drifting past a sun with no cloud anywhere near it. */
    state.snow = s * 1.06;
    /* Lightning — see FLASH above. The gate is a ramp rather than the bare
       `> 0.8` so a storm sliding across the threshold fades its strikes in
       instead of switching them on, and it multiplies the flash rather than
       the trigger, so where a strike lands is decided by the clock alone. */
    const strike = ramp(s, 0.80, 0.88);
    state.flash = 0;
    if (strike > 0 && !CALM) {
      const cell = Math.floor(weatherClock * FLASH.rate);
      if (hash2(cell, 977, 431) < FLASH.chance) {
        state.flash = Math.exp(
          -(weatherClock - cell / FLASH.rate) / FLASH.decay,
        ) * strike;
      }
    }

    /* Wind swings slowly, and hard, once there is enough weather to carry
       it — and gusts on top of that. See `GUST`: the envelope is what turns
       a direction into weather you can feel, and it stiffens towards a
       constant blast as the storm closes so a blizzard does not pulse. */
    const swing = noise2(weatherClock / 23, 9.5, 5) * 2 - 1;
    const gustField = noise2(weatherClock / GUST.period, 3.5, GUST.seed) * 0.7
      + noise2(weatherClock / (GUST.period * 2.6), 8.5, GUST.seed + 1) * 0.3;
    const gustRaw = smooth(Math.min(1, Math.max(0,
      (gustField - GUST.band[0]) / (GUST.band[1] - GUST.band[0]))));
    const gustDepth = (1 - GUST.floor) * (1 - s * 0.55);
    state.gust = 1 - gustDepth + gustDepth * GUST.reach * gustRaw;
    state.windX = swing * (1.5 + s * 16) * state.gust;
    state.windZ = (noise2(weatherClock / 31, 2.5, 6) * 2 - 1) * (1 + s * 6)
      * state.gust;

    /* THE DECK. How much cloud is overhead, and where the wind has taken it.

       Two terms, and the reason there are two is that a sky is not simply a
       function of how hard it is snowing. There is weather that arrives — the
       storm dial, which brings its own lid and takes it away again — and there
       is the ordinary business of a mountain afternoon, where cumulus builds
       over a warm valley whether or not anything is going to come of it. So a
       slow noise runs underneath, on a period of its own, and the storm is
       added to whatever it happens to be saying.

       The ceiling is not one. A deck that reaches full coverage is a grey lid,
       and the one thing this sky must not lose is the deep alpine blue it was
       given — the whole argument for the gradient is that at altitude the sky
       is properly dark twenty degrees off the horizon. Capped at four fifths,
       the worst overcast this game can produce still has blue in the holes,
       which is also what an alpine overcast actually looks like from above the
       valley cloud.

       The drift is in the same coordinates the deck's noise is sampled in, and
       it is wrapped at the field's own 64-unit period rather than allowed to
       grow across a long run. Keeping the phase inside the procedural field's
       own range protects mediump hardware without a reset: wrapping is exact,
       so the same sample comes back at the seam. */
    const build = noise2(weatherClock / CLOUD.period, 4.5, 307) * 0.68
      + noise2(weatherClock / (CLOUD.period * 2.7), 12.5, 308) * 0.42;
    state.cloud = Math.min(CLOUD.max,
      ramp(build, CLOUD.from, CLOUD.to) * CLOUD.fair + s * CLOUD.storm);
    /* The shader samples field(position + phase), so phase travels opposite
       the physical feature. Subtracting the wind makes both the visible deck
       and its projected ground shadow move downwind. */
    state.cloudX = wrap64(state.cloudX - state.windX * dt * CLOUD.drift);
    state.cloudZ = wrap64(state.cloudZ - state.windZ * dt * CLOUD.drift);
    // The sun crosses the run rather than sitting behind it. Side light is
    // the only light that shapes snow: from behind, a mogul field is a flat
    // white sheet with the fill light's colour on it, which is exactly what
    // this looked like before the azimuth was moved round.
    state.azimuth = 1.15 + Math.sin(state.tod * Math.PI * 2) * 0.8;
    return state;
  }

  /* For the pause menu: pin the sky, or let it run again. */
  function pin(tod) {
    if (frozen === null) pinnedTod = state.tod;
    frozen = ((tod % 1) + 1) % 1;
  }
  function release() {
    frozen = null;
    dayClock = state.tod < START_TOD
      ? (1 + state.tod - START_TOD) * DAY_SECONDS
      : (state.tod - START_TOD) * DAY_SECONDS;
  }

  function triggerStorm() {
    if (stormCalled >= 0) return;    // a front is already on the mountain
    stormCalled = 0;
  }

  update(0);
  return { state, update, pin, release, triggerStorm };
}
