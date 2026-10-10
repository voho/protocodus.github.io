/* Meteora — every number the game leans on, in one place.

   Metres, seconds, radians. The values were chosen so they can be checked
   against something real before they are tuned against feel: 45 m/s² is
   a hard-burning fighter at about 4.6 g, the lateral thrusters are half
   that, and the afterburner at 120 m/s² is a brief 12 g sprint that the
   energy bar keeps brief. Flight assist (FA) is the ship's computer using
   those same thrusters to hold the velocity the pilot asks for; it never
   gets a thruster the pilot does not have, which is why a hard turn at
   speed slides. */

export const STEP = 1 / 120;
export const MAX_STEPS = 8;

export const PLAYER = {
  radius: 6,
  accel: { forward: 45, reverse: 25, lateral: 22, boost: 120 },
  fa: { forwardSpeed: 180, boostSpeed: 320, strafeSpeed: 60, tau: 0.25, tauAngular: 0.12 },
  rate: [1.6, 1.1, 2.6],          // pitch, yaw, roll max rad/s
  angAccel: [6, 4, 9],            // rad/s²
  spinCap: 3,                     // FA-off safety cap, × rate
  throttle: { min: -0.35, rampPerSecond: 0.6 },
  boost: { capacity: 100, drain: 25, regen: 12, regenDelay: 1.5, relock: 20 },
  shield: 100, hull: 100, shieldRegen: 15, shieldDelay: 3,
};

export const ENEMY = {
  ...PLAYER,
  radius: 5,
  accel: { forward: 40, reverse: 25, lateral: 26, boost: 110 },
  fa: { forwardSpeed: 200, boostSpeed: 300, strafeSpeed: 70, tau: 0.25, tauAngular: 0.1 },
  rate: [1.9, 1.5, 3.0],
  angAccel: [7, 5, 10],
  shield: 30, hull: 60, shieldRegen: 6, shieldDelay: 4,
};

export const CANNON = {
  rate: 12, speed: 1000, life: 2.2, damage: 8, heat: 4.5, cool: 30, lockAt: 100, releaseAt: 40, radius: 0.3,
};
export const ENEMY_CANNON = {
  rate: 6, speed: 850, life: 2.2, damage: 5, heat: 0, cool: 0, lockAt: Infinity, releaseAt: 0, radius: 0.3,
  burst: [0.8, 1.4], pause: [0.6, 1.2],
};
export const MISSILE = {
  capacity: 6, rearm: 8, lockCone: 15 * Math.PI / 180, lockRange: 3000, lockTime: 0.8,
  launchKick: 30, ignition: 0.25, accel: 220, maxSpeed: 650, navGain: 4, maxLateral: 350,
  life: 8, fuse: 12, damage: 80, blast: 30, radius: 0.6,
};

export const FIELD = {
  half: [4000, 1000, 4000],
  spawn: [0, 0, 0], spawnClear: 200,
  cell: 1000, hashCell: 100, bigRadius: 300, maxDynamic: 64,
  types: [  // nominal bounding radius, count, draw distance (m)
    { radius: 1.5, count: 12000, draw: 1500 },
    { radius: 4, count: 6000, draw: 3000 },
    { radius: 12, count: 2500, draw: 6000 },
    { radius: 40, count: 600, draw: Infinity },
    { radius: 125, count: 150, draw: Infinity },
  ],
  landmarks: { count: 6, scale: [6, 10] },
  scale: [0.7, 1.4], collide: 0.85, gap: 0.95,
  destructible: 3, hpPerRadius: 5,   // hp = 5 · r^1.5 for types 0–2
};

export const COMBAT = {
  wave: { base: 2, cap: 10, near: 2500, far: 3500, viewCone: 60 * Math.PI / 180, delay: 6 },
  score: { kill: 100, rock: [10, 25, 50] },
  collision: { safe: 8, perMs: 1.2, restitution: 0.35, friction: 0.85 },
  leaving: 3000,
};

export const SHAKE = {
  idle: 0.02, engine: 0.12, rumble: 0.35, rcsKick: 0.08,
  buffet: 0.0025, buffetGrain: 0.9,  // buffet amplitude per (m/s × density)
  shipShare: 0.35, maxImpact: 1.6,
};

export const RENDER = {
  far: 60000, near: 0.5, fov: 70, dprCap: 2,
  scaleMin: 0.6, scaleMax: 1, targetMs: 16.7,
  shadowBox: 600, shadowSize: 2048, lights: 8,
  skyFace: 2048, brightStars: 2500,
};
