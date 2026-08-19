/* The voyage's one table of truth: palette, world layout, camera anchors and
   quality tiers. Everything that is a number somebody might want to retune
   lives here rather than inside the module that spends it. */

export const PALETTE = {
  mint: 0x00ffc3,
  mintDeep: 0x00b894,
  yellow: 0xffc400,
  amber: 0xff9f00,
  paper: 0xfafafa,
  ink: 0x0a0d14,
  // The sky is not black: deep space on film is a very dark blue, and a true
  // black clears to banding the moment a glow lands on it.
  space: 0x030509,
  hullDark: 0x1c2129,
  hullLight: 0x39414e,
  planetSea: 0x0d2a4a,
  planetLand: 0x1b6b5a,
  abyssGlow: 0x2bffd0,
  engine: 0x7fd8ff,
};

/* World layout. The station stands at the origin with its spindle on Y; the
   camera never leaves its neighbourhood, so everything else is placed around
   that. Units are metres-ish — they only have to agree with each other. */
export const WORLD = {
  sun: { dir: [0.62, 0.34, 0.71], color: 0xfff3dd, intensity: 4.5 },
  planet: { pos: [-2500, 650, -2700], radius: 850 },
  gates: [
    { pos: [640, 40, -560], radius: 64, yaw: 2.28 },   // the working gate
    { pos: [-980, -80, 760], radius: 46, yaw: -0.6 },  // a far one, for depth
  ],
  abyss: { pos: [520, -780, -260], radius: 320 },
  // Docking cradles at the tips of the four arms; traffic flies gate → dock
  // → gate. Kept in sync with the arm geometry in station.js by both reading
  // ARM_LENGTH from here.
  armLength: 150,
  dockYs: [8, 8, 8, 8],
};

/* Camera anchors, one per waypoint, in document order. The page maps scroll
   position onto this list; the camera rides a Catmull-Rom through `pos` and
   eases its gaze between `look`s. Each anchor is a view of the same station,
   which is what keeps the flight readable — you always know where you are
   relative to the thing you have been orbiting since the hero. */
export const ANCHORS = [
  { zone: 'approach', pos: [260, 75, 480], look: [0, 58, -30], label: 'APPROACH VECTOR' },
  { zone: 'forge', pos: [235, 35, 190], look: [95, 0, -70], label: 'WP-01 · THE FORGE' },
  { zone: 'lanes', pos: [850, 95, 320], look: [270, 30, -250], label: 'WP-02 · APPROACH LANES' },
  { zone: 'ring', pos: [-150, 130, 215], look: [-15, 58, -55], label: 'WP-03 · HABITAT RING' },
  { zone: 'abyss', pos: [400, -660, 120], look: [700, -800, -320], label: 'WP-04 · THE ABYSS' },
  { zone: 'spire', pos: [-150, 300, 235], look: [0, 185, -10], label: 'WP-05 · SIGNAL SPIRE' },
  { zone: 'registry', pos: [120, 150, 580], look: [0, 45, 0], label: 'DOCKED · REGISTRY' },
];

/* Two tiers only. The phone tier halves the crowds and caps resolution; the
   adaptive governor in stage.js can pull resolution further on any machine
   that turns out to be slower than its class. */
export function detectQuality() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = matchMedia('(max-width: 820px)').matches;
  const lite = coarse || small;
  return {
    lite,
    dprCap: lite ? 1.5 : 2,
    stars: lite ? 2600 : 5200,
    windows: lite ? 1100 : 2400,
    nebula: lite ? 26 : 48,
    traffic: lite ? 7 : 13,
    jellies: lite ? 5 : 9,
    snow: lite ? 350 : 900,
    streaks: lite ? 140 : 260,
  };
}
