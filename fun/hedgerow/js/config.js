/* Hedgerow — tuning. Distances in metres, times in seconds, angles in
   radians unless the name says otherwise. */

export const PLAYER = {
  radius: 0.34,
  height: 1.78,
  crouchHeight: 1.2,
  eye: 1.62,
  crouchEye: 1.08,
  walk: 2.7,
  aimWalk: 1.7,
  run: 5.4,          // sprint
  crouchWalk: 1.4,
  wade: 0.55,        // speed factor in water above the knees
  accel: 22,
  airAccel: 4,
  gravity: 19,
  jump: 4.6,
  step: 0.45,        // climbs without jumping
  vault: 1.35,       // highest top that can be vaulted
  health: 100,
  regenDelay: 4.5,
  regenRate: 22,
  maxWade: 1.25,     // deeper water is impassable
};

export const CAMERA = {
  firstPerson: true,  // through his eyes; the over-the-shoulder rig stays for the death camera
  fov: 68,
  aimFov: 46,
  fpAimFov: 52,      // down the iron sights (first person: the rifle is in the picture)
  sprintFov: 6,      // added while sprinting (first person)
  near: 0.05,
  distance: 3.2,
  aimDistance: 1.35,
  height: 0.36,      // above the eye
  shoulder: 0.7,
  aimShoulder: 0.55,
  minPitch: -1.25,
  maxPitch: 1.1,
  collideRadius: 0.22,
};

export const WEAPONS = {
  garand: {
    name: 'M1 Garand', model: 'm1_garand', kind: 'rifle',
    damage: 62, headMul: 3.2, limbMul: 0.75, interval: 0.17, auto: false,
    mag: 8, reserve: 72, reload: 2.2, prop: 'garand_clip', propSize: [0.055, 0.05, 0.02], ejects: true,
    spreadHip: 0.035, spreadAim: 0.004, spreadMove: 0.03, bloom: 0.02, bloomDecay: 3.5,
    recoil: 0.034, recoilYaw: 0.01, range: 260, sound: 'garand', tracer: false,
    // the sight line in the model (rear aperture, front post) and the eye behind it
    sight: { rear: [0, 0.089, 0.01], front: [0, 0.083, 0.76], relief: 0.16 }, reach: 0.95,
  },
  thompson: {
    name: 'M1A1 Thompson', model: 'thompson', kind: 'smg',
    damage: 27, headMul: 2.5, limbMul: 0.8, interval: 0.085, auto: true,
    mag: 30, reserve: 180, reload: 2.5, prop: 'thompson_mag', propSize: [0.035, 0.26, 0.075], drops: true, seated: 'thompson_mag_seated',
    spreadHip: 0.05, spreadAim: 0.018, spreadMove: 0.03, bloom: 0.008, bloomDecay: 5,
    recoil: 0.012, recoilYaw: 0.008, range: 120, sound: 'thompson', tracer: false,
    sight: { rear: [0, 0.121, 0.06], front: [0, 0.104, 0.44], relief: 0.12 }, reach: 0.7,
    // where the magazine model sits in the gun (weapons.glb, thompson_mag_seated)
    seatedAt: { p: [0, -0.13, 0.104], q: [-0.62089, -0.066765, 0.166366, 0.763129] },
  },
};

export const ENEMY_WEAPONS = {
  kar98k: { model: 'kar98k', interval: 1.7, burst: 1, damage: [22, 30], range: 85, sound: 'kar98k', tracer: 0.0, mag: 5, reload: 3.2, prop: 'kar98k_clip' },
  mp40: { model: 'mp40', interval: 0.11, burst: [4, 8], damage: [9, 13], range: 45, sound: 'mp40', tracer: 0.25, mag: 32, reload: 2.6, prop: 'mp40_mag', drops: true, seated: 'mp40_mag_seated' },
  mg42: { model: 'mg42', interval: 0.05, burst: [12, 26], damage: [10, 14], range: 110, sound: 'mg42', tracer: 0.34, mag: 75, reload: 5.5 },
  sniper: { model: 'kar98k', interval: 3.6, burst: 1, damage: [62, 75], range: 170, sound: 'kar98k', tracer: 0.0, mag: 5, reload: 3.6, prop: 'kar98k_clip' },
};

// ground speed of each locomotion clip at 1x (no foot sliding), from the rig
export const GAIT = { walk: 1.31, walk_back: 0.88, strafe_l: 0.54, strafe_r: 0.54, run: 3.6, crouch_walk: 0.83 };

export const ENEMY = {
  health: 100,
  viewRange: 52,
  viewFov: 1.15,      // half-angle
  hearRange: 70,
  awareRate: 1.4,     // per second at close range, fully visible
  reaction: [0.45, 0.85],
  radius: 0.34,
  walk: 1.6,
  run: 4.2,
};

// Difficulty scales how well the enemy shoots and how much it hurts.
export const DIFFICULTY = {
  recruit: { accuracy: 0.6, damage: 0.6, aware: 0.75 },
  regular: { accuracy: 0.85, damage: 0.85, aware: 1.0 },
  veteran: { accuracy: 1.1, damage: 1.15, aware: 1.25 },
};

export const GRENADE = {
  fuse: 3.4,
  radius: 7,
  damage: 170,
  throwSpeed: 16,
  carry: 4,
  max: 6,
};

export const QUALITY = {
  high: { pixelRatio: 1.5, bloom: true, volumetric: true, ao: true, ssr: true, shadows: 512, grass: 1, rain: 9000, blades: 192, relief: 1, clutter: 1, treeNear: 52 },
  medium: { pixelRatio: 1, bloom: true, volumetric: true, ao: true, ssr: true, shadows: 256, grass: 0.6, rain: 6000, blades: 128, relief: 1, clutter: 1, treeNear: 48 },
  low: { pixelRatio: 0.75, bloom: false, volumetric: false, ao: false, ssr: false, shadows: 0, grass: 0.3, rain: 3500, blades: 0, relief: 0, clutter: 0, treeNear: 36 },
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1,
  invertY: false,
  volume: 0.8,
  fov: CAMERA.fov,
  difficulty: 'regular',
  quality: 'high',
};
