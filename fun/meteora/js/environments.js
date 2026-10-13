/* Meteora — where each mission happens: its sky, its light, its dust.

   The belt is wide, and no two places in it should look alike. A look
   says where the sun stands and how it burns, which planet hangs in the
   sky (if any) and how it is lit, which nebulae lie behind, how bright the
   Milky Way is, the colours of the drifting veils, the light the ships are
   lit by, and how much dust streams past the canopy.

   The sun is Pindus, everywhere the same star: what changes is
   where it stands from the place, and what lies between — dust in the Deep
   reddens and dims it, and at the belt's edge it is smaller. The gas
   giants are the system's own: the banded tan one the Perpetua has always
   orbited, the cold blue one over Varlaam, the rust giant the Narrows run
   beneath.

   `sky` goes to sky.js (see DEFAULT_SKY there for every field), `light` to
   the scene's lights, `dust` to dust.js. Directions are unit-ish vectors in
   world space; each look is set where a mission's opening view will find
   its best part. */

const SUN = { colour: 0xfff1e0, intensity: 5 };
const HEMI = { sky: 0x8ea6d8, ground: 0x6e5a48, intensity: 0.45 };
export const DEFAULT_LIGHT = { sun: SUN, hemi: HEMI, ambient: 0.05, fill: 1.3, environment: 0.45 };
export const DEFAULT_DUST = { amount: 1, tint: [0.75, 0.82, 1] };

// Varlaam Deep's sky, the same for both missions flown there.
const VARLAAM_SKY = {
  seed: 41,
  galaxy: { normal: [0.5, 0.8, 0.33], band: 1.1 },
  nebulae: [
    { kind: 'reflection', at: [0.2, 0.45, -0.87], radius: 0.34, gain: 0.42 },
    { kind: 'emission', at: { band: 0.25 }, radius: 0.22, gain: 0.26, tint: [0.45, 0.95, 1.15] },
    { kind: 'planetary', at: { off: 0.2 }, radius: 0.02, gain: 0.55 },
    { kind: 'dark', at: { band: 0.2 }, radius: 0.26, gain: 1 },
  ],
  planet: { dir: [-0.3, -0.18, -0.94], distance: 48000, radius: 9000, pole: [0.15, 1, 0.1], rings: false, palette: 'ice' },
};

export const LOOKS = {
  // Sector Seven — home: the giant the Perpetua orbits over one shoulder,
  // the sun over the other. The menus fly here, and Survival.
  sector7: {},

  // The Roussanou lane runs under the giant, in a long golden afternoon.
  roussanou: {
    sky: {
      seed: 21,
      galaxy: { normal: [0.1, 0.85, -0.5], band: 0.9 },
      nebulae: [
        { kind: 'reflection', at: [-0.62, 0.48, 0.62], radius: 0.2, gain: 0.32 },
        { kind: 'emission', at: { band: 0.25 }, radius: 0.28, gain: 0.28, tint: [1.1, 0.8, 0.55] },
        { kind: 'dark', at: { band: 0.2 }, radius: 0.3, gain: 1 },
        { kind: 'planetary', at: { off: 0.2 }, radius: 0.02, gain: 0.5 },
      ],
      veils: [
        { a: [0.55, 0.38, 0.12], b: [0.15, 0.4, 0.45], gain: 0.07 },
        { a: [0.5, 0.25, 0.1], b: [0.3, 0.3, 0.5], gain: 0.04 },
      ],
      planet: { dir: [0.6, 0.22, 0.77], distance: 30000, radius: 9000, pole: [-0.35, 1, -0.5], rings: true, palette: 'tan' },
      sun: { dir: [-0.75, 0.35, -0.56], colour: [1, 0.9, 0.74], corona: [1, 0.7, 0.42] },
    },
    light: { sun: { colour: 0xffd8a6, intensity: 5.2 }, hemi: { sky: 0x9aa6c8, ground: 0x7a5a3a, intensity: 0.5 } },
    dust: { amount: 1, tint: [1, 0.86, 0.66] },
  },

  // Kalavryta Deep: dense and dark. Dust walls off half the sky, the
  // Milky Way is a smear, and the sun a dull coin behind you.
  kalavryta: {
    sky: {
      seed: 33,
      galaxy: { normal: [-0.3, 0.9, 0.3], band: 0.45 },
      stars: 0.55,
      nebulae: [
        { kind: 'dark', at: [-0.5, 0.1, -0.86], radius: 0.55, gain: 1 },
        { kind: 'dark', at: [0.45, -0.35, -0.82], radius: 0.42, gain: 1 },
        { kind: 'emission', at: { off: 0.3 }, radius: 0.16, gain: 0.16, tint: [1, 0.55, 0.5] },
        { kind: 'remnant', at: { band: 0.4 }, radius: 0.14, gain: 0.18, tint: [0.5, 1, 0.7] },
        { kind: 'dark', at: { band: 0.25 }, radius: 0.35, gain: 1 },
      ],
      veils: [
        { a: [0.1, 0.3, 0.25], b: [0.2, 0.15, 0.3], gain: 0.035 },
        { a: [0.25, 0.2, 0.12], b: [0.1, 0.18, 0.2], gain: 0.025 },
      ],
      planet: null,
      sun: { dir: [0.3, 0.55, 0.78], colour: [1, 0.78, 0.58], corona: [0.9, 0.52, 0.32], size: 0.8, glow: 0.45 },
    },
    light: { sun: { colour: 0xffc29a, intensity: 2.8 }, hemi: { sky: 0x5a6a80, ground: 0x3a3430, intensity: 0.32 }, ambient: 0.04, fill: 1.1, environment: 0.35 },
    dust: { amount: 1.5, tint: [0.62, 0.72, 0.68] },
  },

  // Varlaam Deep, cold and blue: the ice giant low ahead, lit full.
  varlaam: {
    sky: {
      ...VARLAAM_SKY,
      veils: [
        { a: [0.08, 0.38, 0.6], b: [0.15, 0.25, 0.65], gain: 0.08 },
        { a: [0.1, 0.5, 0.5], b: [0.3, 0.3, 0.55], gain: 0.04 },
      ],
      sun: { dir: [0.62, 0.55, 0.56], colour: [0.92, 0.96, 1], corona: [0.8, 0.86, 1] },
    },
    light: { sun: { colour: 0xe8f0ff, intensity: 5 }, hemi: { sky: 0x8fb4e0, ground: 0x4a6a80, intensity: 0.5 } },
    dust: { amount: 0.9, tint: [0.7, 0.85, 1] },
  },

  // Varlaam three days on, the evacuation: the sun has swung round behind
  // the giant, a thin crescent now, and the veils run red.
  varlaamLate: {
    sky: {
      ...VARLAAM_SKY,
      veils: [
        { a: [0.5, 0.12, 0.15], b: [0.35, 0.15, 0.4], gain: 0.06 },
        { a: [0.1, 0.35, 0.5], b: [0.4, 0.2, 0.2], gain: 0.04 },
      ],
      sun: { dir: [-0.55, 0.42, -0.72], colour: [1, 0.88, 0.76], corona: [1, 0.66, 0.42] },
    },
    light: { sun: { colour: 0xffe0c0, intensity: 5 }, hemi: { sky: 0x8a9cc8, ground: 0x40506a, intensity: 0.42 } },
    dust: { amount: 0.8, tint: [0.95, 0.8, 0.8] },
  },

  // The long night: the Perpetua crawls through the giant's shadow. The
  // sun is behind the planet, which hangs over the fight as a black disc
  // ringed with fire; what light there is comes through its air, red.
  eclipse: {
    sky: {
      seed: 61,
      galaxy: { normal: [0.4, 0.8, -0.45], band: 1.25 },
      stars: 1.35,
      nebulae: [
        { kind: 'emission', at: [0.5, -0.2, -0.84], radius: 0.4, gain: 0.36 },
        { kind: 'remnant', at: { band: 0.4 }, radius: 0.15, gain: 0.3 },
        { kind: 'reflection', at: { off: 0.3 }, radius: 0.12, gain: 0.2 },
        { kind: 'dark', at: { band: 0.2 }, radius: 0.24, gain: 1 },
      ],
      veils: [
        { a: [0.45, 0.08, 0.12], b: [0.25, 0.1, 0.4], gain: 0.05 },
        { a: [0.12, 0.2, 0.45], b: [0.4, 0.15, 0.1], gain: 0.03 },
      ],
      planet: { dir: [-0.69, 0.2, 0.69], distance: 34000, radius: 9000, pole: [0.3, 1, 0.35], rings: true, palette: 'tan' },
      sun: { dir: [-0.69, 0.2, 0.69], distance: 80000 },
    },
    light: { sun: { colour: 0xff7a48, intensity: 1.3 }, hemi: { sky: 0x3a4868, ground: 0x502818, intensity: 0.42 }, ambient: 0.06, fill: 1.7, environment: 0.3 },
    dust: { amount: 0.7, tint: [0.85, 0.6, 0.5] },
  },

  // The Roussanou drag: open space between the belt and the Anchorage,
  // under a great violet nebula.
  drag: {
    sky: {
      seed: 77,
      galaxy: { normal: [0.6, 0.75, -0.28], band: 1 },
      nebulae: [
        { kind: 'emission', at: [-0.1, 0.3, -0.95], radius: 0.55, gain: 0.42, tint: [1.2, 0.55, 1.35] },
        { kind: 'reflection', at: [-0.45, 0.5, -0.74], radius: 0.24, gain: 0.3, tint: [0.9, 0.6, 1.25] },
        { kind: 'planetary', at: { off: 0.2 }, radius: 0.02, gain: 0.55 },
        { kind: 'dark', at: { band: 0.2 }, radius: 0.22, gain: 1 },
      ],
      veils: [
        { a: [0.6, 0.15, 0.5], b: [0.1, 0.5, 0.5], gain: 0.09 },
        { a: [0.35, 0.1, 0.55], b: [0.55, 0.3, 0.2], gain: 0.04 },
      ],
      planet: { dir: [0.7, -0.5, 0.5], distance: 70000, radius: 7000, pole: [0.2, 1, -0.3], rings: false, palette: 'rust' },
      sun: { dir: [0.45, 0.75, 0.48], colour: [0.96, 0.97, 1], corona: [0.95, 0.85, 0.85] },
    },
    light: { sun: { colour: 0xf4f6ff, intensity: 5.5 }, hemi: { sky: 0x9a8ad8, ground: 0x5a4a6a, intensity: 0.45 } },
    dust: { amount: 0.4, tint: [0.85, 0.78, 1] },
  },

  // The Deep Anchorage: Harrow country. A dead star's shell glows red
  // behind the Mother, and the sun is small and far.
  anchorage: {
    sky: {
      seed: 88,
      galaxy: { normal: [-0.2, 0.85, 0.48], band: 0.7 },
      nebulae: [
        { kind: 'remnant', at: [0.05, 0.12, -0.99], radius: 0.45, gain: 0.55, tint: [1.25, 0.55, 0.45] },
        { kind: 'emission', at: [-0.5, 0.4, -0.77], radius: 0.34, gain: 0.38, tint: [1.1, 0.7, 0.8] },
        { kind: 'dark', at: { band: 0.2 }, radius: 0.3, gain: 1 },
        { kind: 'dark', at: [0.4, -0.25, -0.88], radius: 0.25, gain: 1 },
      ],
      veils: [
        { a: [0.6, 0.1, 0.12], b: [0.4, 0.15, 0.08], gain: 0.08 },
        { a: [0.3, 0.05, 0.1], b: [0.5, 0.25, 0.1], gain: 0.05 },
      ],
      planet: null,
      sun: { dir: [0.62, 0.48, 0.62], colour: [1, 0.85, 0.7], corona: [1, 0.58, 0.34], size: 0.7, glow: 0.7 },
    },
    light: { sun: { colour: 0xffd0ac, intensity: 3.8 }, hemi: { sky: 0x8a6a7a, ground: 0x4a2018, intensity: 0.42 }, environment: 0.4 },
    dust: { amount: 1.1, tint: [1, 0.62, 0.48] },
  },

  // The Narrows run beneath the rust giant, close enough to fill a fifth
  // of the sky; the sun low behind lights its face.
  narrows: {
    sky: {
      seed: 99,
      galaxy: { normal: [0.3, 0.9, 0.3], band: 0.8 },
      nebulae: [
        { kind: 'emission', at: { band: 0.3 }, radius: 0.3, gain: 0.26, tint: [1.15, 0.85, 0.5] },
        { kind: 'dark', at: { band: 0.2 }, radius: 0.3, gain: 1 },
        { kind: 'reflection', at: { off: 0.3 }, radius: 0.14, gain: 0.2 },
        { kind: 'remnant', at: { band: 0.5 }, radius: 0.12, gain: 0.22 },
      ],
      veils: [
        { a: [0.55, 0.38, 0.12], b: [0.3, 0.35, 0.15], gain: 0.06 },
        { a: [0.45, 0.2, 0.1], b: [0.2, 0.25, 0.35], gain: 0.035 },
      ],
      planet: { dir: [0.72, 0.36, -0.59], distance: 26000, radius: 9000, pole: [-0.3, 1, -0.45], rings: true, palette: 'rust' },
      sun: { dir: [-0.62, 0.12, 0.78], colour: [1, 0.92, 0.8], corona: [1, 0.72, 0.45] },
    },
    light: { sun: { colour: 0xffe4c4, intensity: 5.2 }, hemi: { sky: 0x9a8a78, ground: 0x7a4a2a, intensity: 0.55 } },
    dust: { amount: 1.3, tint: [1, 0.84, 0.62] },
  },

  // The Well: Pindus's dead companion, ten astronomical units out. The sun
  // is a bright star behind; the light is the accretion disk's, and the
  // whole sky is seen through the hole's lens (the bright stars and veils
  // are left out: they would not bend with it).
  well: {
    sky: {
      seed: 121,
      galaxy: { normal: [0.15, 0.35, 0.92], band: 1.5 },
      stars: 1.2,
      brightStars: false,
      nebulae: [
        { kind: 'emission', at: { band: 0.2 }, radius: 0.22, gain: 0.3, tint: [0.9, 0.75, 1.1] },
        { kind: 'reflection', at: { off: 0.3 }, radius: 0.16, gain: 0.25 },
        { kind: 'dark', at: { band: 0.15 }, radius: 0.24, gain: 1 },
      ],
      veils: [],
      planet: null,
      sun: { dir: [-0.25, 0.35, -0.9], colour: [1, 0.78, 0.6], corona: [1, 0.6, 0.38], size: 0.45, glow: 0.5 },
    },
    light: { sun: { colour: 0xffc8a0, intensity: 1.4 }, hemi: { sky: 0x4a5068, ground: 0x6a4028, intensity: 0.3 }, ambient: 0.04, fill: 1.4, environment: 0.3, hole: 7 },
    dust: { amount: 0.5, tint: [1, 0.78, 0.55] },
  },

  // The belt's edge: ahead, nothing but the Milky Way at its brightest;
  // behind, the last rocks, and home a thin crescent far away.
  edge: {
    sky: {
      seed: 110,
      galaxy: { normal: [0.9, 0.2, -0.26], centre: [-0.31, -0.2, -0.93], band: 1.6 },
      stars: 1.15,
      nebulae: [
        { kind: 'reflection', at: [0.35, 0.3, -0.89], radius: 0.3, gain: 0.45 },
        { kind: 'emission', at: { band: 0.2 }, radius: 0.25, gain: 0.3 },
        { kind: 'planetary', at: { off: 0.25 }, radius: 0.02, gain: 0.6 },
        { kind: 'dark', at: { band: 0.15 }, radius: 0.25, gain: 1 },
      ],
      veils: [
        { a: [0.08, 0.2, 0.55], b: [0.4, 0.32, 0.12], gain: 0.06 },
        { a: [0.15, 0.3, 0.6], b: [0.3, 0.15, 0.4], gain: 0.03 },
      ],
      planet: { dir: [0.25, 0.12, 0.96], distance: 70000, radius: 9000, pole: [0.25, 1, -0.18], rings: true, palette: 'tan' },
      sun: { dir: [0.85, 0.32, 0.42], size: 0.75 },
    },
    light: { sun: { colour: 0xfff1e0, intensity: 4.6 }, hemi: { sky: 0x8ea6d8, ground: 0x3a4050, intensity: 0.42 } },
    dust: { amount: 0.55, tint: [0.8, 0.85, 1] },
  },
};

/* The full look for a key (or a look given inline), every part filled in. */
export function lookFor(key) {
  const look = typeof key === 'object' && key ? key : LOOKS[key] ?? LOOKS.sector7;
  return {
    sky: look.sky ?? {},
    light: { ...DEFAULT_LIGHT, ...look.light, sun: { ...SUN, ...look.light?.sun }, hemi: { ...HEMI, ...look.light?.hemi } },
    dust: { ...DEFAULT_DUST, ...look.dust },
  };
}
