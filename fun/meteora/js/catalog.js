/* Meteora — every class of thing that flies, drifts or stands in the belt.

   A class says how something moves (the same flight stats the player's
   fighter uses: see flight.js), how much it can take, what it carries and
   which model draws it. Players choose among the three Belt Watch hulls;
   everything else is placed by missions.

   Sizes:
     small  fighters, bombers, drones, torpedoes: one collision sphere,
            the full flight model, AI pilots
     large  freighters, shuttles, capital ships, stations, Harrow pylons:
            compound collision spheres from the model's `col_*` empties,
            subsystems and turrets, a helm instead of a pilot
     prop   sentries, seeds, wrecks and other things that mostly sit still

   Numbers are metres, seconds, kilograms. Shields are a total, split into
   four quadrants at runtime (combat.js). Armour is the fraction of hull
   damage a non-piercing weapon loses (weapons carry a `pierce`). */

import { PLAYER, ENEMY } from './config.js';

const deg = Math.PI / 180;

/* Flight stats in the shape stepShip expects, built from a few numbers. */
function flight({
  radius, mass, gyration, forward, reverse, lateral, boost, cruise, boostSpeed, strafe,
  rate, angAccel, tau = 0.2, tauAngular = 0.05, boostCapacity = 100, shield = 0, hull = 1,
  shieldRegen = 0, shieldDelay = 3, spinCap = 3, throttleMin = -0.35,
}) {
  return {
    radius, mass, gyration,
    accel: { forward, reverse, lateral, boost },
    fa: { forwardSpeed: cruise, boostSpeed, strafeSpeed: strafe, tau, tauAngular },
    rate, angAccel, spinCap,
    throttle: { min: throttleMin, rampPerSecond: 0.7 },
    boost: { capacity: boostCapacity, drain: 25, regen: 12, regenDelay: 1.5, relock: 20 },
    shield, hull, shieldRegen, shieldDelay,
  };
}

/* A large ship's flight: very heavy, slow to turn, its helm holding speed. */
function heavy({ radius, mass, cruise, accel = 2.5, rate = 0.06, angAccel = 0.05 }) {
  return flight({
    radius, mass, gyration: [radius * 0.35, radius * 0.35, radius * 0.18],
    forward: accel, reverse: accel * 0.6, lateral: accel * 0.4, boost: accel,
    cruise, boostSpeed: cruise, strafe: cruise * 0.2,
    rate: [rate, rate, rate * 0.6], angAccel: [angAccel, angAccel, angAccel * 0.6],
    tau: 1.2, tauAngular: 0.6, boostCapacity: 0, throttleMin: -0.2,
  });
}

export const CLASSES = {
  /* ---------- Belt Watch: the player's hulls ---------- */
  swift: {
    name: 'Swift', type: 'Interceptor', faction: 'watch', size: 'small', model: 'swift', role: 'fighter',
    blurb: 'Light, fast and fragile. The smallest return on any sensor in the belt.',
    flight: flight({
      radius: 4.6, mass: 16000, gyration: [2.2, 2.5, 1.5],
      forward: 62, reverse: 32, lateral: 38, boost: 150, cruise: 235, boostSpeed: 410, strafe: 85,
      rate: [2.5, 2.0, 3.8], angAccel: [13, 10, 17], boostCapacity: 120,
    }),
    shield: 90, hull: 60, armor: 0, signature: 0.6, shieldRegen: 20, shieldDelay: 2.5,
    banks: [{ capacity: 6, heavy: false }],
    defaults: { primary: 'needle', secondaries: ['hornet'], reactor: 'hush' },
  },
  kestrel: {
    name: 'Kestrel', type: 'Fighter', faction: 'watch', size: 'small', model: 'fighter', role: 'fighter',
    blurb: 'The Watch\'s workhorse: gimballed wingtip guns, two weapon bays, honest armour.',
    flight: flight({
      radius: 6, mass: 30000, gyration: [3.2, 3.6, 2.2],
      forward: 48, reverse: 28, lateral: 30, boost: 125, cruise: 190, boostSpeed: 330, strafe: 65,
      rate: [2.0, 1.6, 3.0], angAccel: [10, 7.5, 13],
    }),
    shield: 140, hull: 120, armor: 0.1, signature: 1, shieldRegen: 18, shieldDelay: 2.8,
    banks: [{ capacity: 8, heavy: false }, { capacity: 8, heavy: true }],
    defaults: { primary: 'pulse', secondaries: ['hornet', 'hornet'], reactor: 'hearth' },
  },
  anvil: {
    name: 'Anvil', type: 'Bomber', faction: 'watch', size: 'small', model: 'anvil', role: 'bomber',
    blurb: 'Slow, armoured and patient. Carries the torpedoes that crack capital ships.',
    flight: flight({
      radius: 8.6, mass: 55000, gyration: [4.4, 5, 3.2],
      forward: 32, reverse: 18, lateral: 18, boost: 80, cruise: 135, boostSpeed: 230, strafe: 40,
      rate: [1.3, 1.0, 2.0], angAccel: [6, 4.5, 8], boostCapacity: 85,
    }),
    shield: 220, hull: 240, armor: 0.25, signature: 1.6, shieldRegen: 22, shieldDelay: 3.2,
    banks: [{ capacity: 8, heavy: false }, { capacity: 16, heavy: true }],
    rearTurret: 'tailgun',
    defaults: { primary: 'breaker', secondaries: ['hornet', 'lance'], reactor: 'aegis' },
  },

  /* ---------- Belt Watch support ---------- */
  tender: {
    name: 'Tender', type: 'Repair drone', faction: 'watch', size: 'small', model: 'drone', role: 'tender',
    flight: flight({
      radius: 2.2, mass: 1500, gyration: [1, 1, 1],
      forward: 70, reverse: 50, lateral: 50, boost: 70, cruise: 260, boostSpeed: 260, strafe: 60,
      rate: [3, 3, 3], angAccel: [14, 14, 14],
    }),
    shield: 40, hull: 60, armor: 0, signature: 0.4, shieldRegen: 5, shieldDelay: 3,
  },

  halberd: {
    name: 'Halberd', type: 'Gunship', faction: 'watch', size: 'large', model: 'halberd', role: 'capital',
    flight: heavy({ radius: 84, mass: 2.5e7, cruise: 70, accel: 8, rate: 0.18, angAccel: 0.12 }),
    shield: 1500, hull: 4000, armor: 0.5, signature: 6, shieldRegen: 30, shieldDelay: 5, score: 0,
    subsystems: {
      engine: { hull: 900, armor: 0.5, exposed: true }, bridge: { hull: 800, armor: 0.6 },
      turret: { hull: 260, armor: 0.3, weapon: 'plasmaTurret', exposed: true },
    },
    turretWeapons: ['plasmaTurret', 'plasmaTurret', 'flakTurretWatch'],
  },

  /* ---------- Belt civilians ---------- */
  mule: {
    name: 'Mule', type: 'Ore freighter', faction: 'civil', size: 'large', model: 'freighter', role: 'freighter',
    flight: heavy({ radius: 58, mass: 4e6, cruise: 55, accel: 6, rate: 0.25, angAccel: 0.25 }),
    shield: 300, hull: 1400, armor: 0.3, signature: 3, shieldRegen: 6, shieldDelay: 5,
  },
  skiff: {
    name: 'Skiff', type: 'Evacuation shuttle', faction: 'civil', size: 'large', model: 'shuttle', role: 'shuttle',
    flight: heavy({ radius: 15, mass: 2.4e5, cruise: 90, accel: 14, rate: 0.6, angAccel: 0.8 }),
    shield: 120, hull: 320, armor: 0.1, signature: 2, shieldRegen: 6, shieldDelay: 4,
  },
  varlaam: {
    name: 'Varlaam', type: 'Mining station', faction: 'civil', size: 'large', model: 'station', role: 'station',
    fixed: true, flight: heavy({ radius: 260, mass: 1e11, cruise: 0 }),
    shield: 1200, hull: 12000, armor: 0.5, signature: 10, shieldRegen: 8, shieldDelay: 6,
    subsystems: {
      reactor: { hull: 1600, armor: 0.55, exposed: true }, dock: { hull: 1800, armor: 0.4 }, comms: { hull: 600, armor: 0.2 },
      turret: { hull: 300, armor: 0.3, weapon: 'stationTurret', exposed: true },
    },
  },
  perpetua: {
    name: 'Perpetua', type: 'Carrier', faction: 'watch', size: 'large', model: 'perpetua', role: 'capital',
    flight: heavy({ radius: 720, mass: 6e9, cruise: 20, accel: 1.2, rate: 0.02, angAccel: 0.01 }),
    shield: 2000, hull: 30000, armor: 0.5, signature: 20, shieldRegen: 10, shieldDelay: 6,
    subsystems: {
      engine: { hull: 1800, armor: 0.5, exposed: true }, bridge: { hull: 2000, armor: 0.6 }, hangar: { hull: 2500, armor: 0.5 },
      turret: { hull: 300, armor: 0.3, weapon: 'oldTurret', exposed: true },
    },
  },
  mercy: {
    name: 'Long Mercy', type: 'Colony ark', faction: 'civil', size: 'large', model: 'colony', role: 'capital',
    flight: heavy({ radius: 470, mass: 3e9, cruise: 15, accel: 1, rate: 0.02, angAccel: 0.01 }),
    shield: 2500, hull: 20000, armor: 0.5, signature: 15, shieldRegen: 12, shieldDelay: 6,
    subsystems: {
      drive: { hull: 4000, armor: 0.6, exposed: true }, engine: { hull: 2000, armor: 0.5 },
      turret: { hull: 280, armor: 0.3, weapon: 'plasmaTurret', exposed: true },
    },
  },
  wreck: {
    name: 'Saint Amaro', type: 'Derelict tug', faction: 'civil', size: 'large', model: 'freighter', role: 'prop',
    fixed: true, flight: heavy({ radius: 58, mass: 4e6, cruise: 0 }),
    shield: 0, hull: 1e6, armor: 0.9, signature: 0, derelict: true,
  },
  boulder: {
    name: 'Boulder', type: 'Rockfall', faction: 'neutral', size: 'large', model: 'rock:2', modelScale: 1.5, role: 'prop',
    fixed: true, flight: heavy({ radius: 18, mass: 4e7, cruise: 0 }),
    shield: 0, hull: 240, armor: 0.25, signature: 0, rock: true,
  },
  recorder: {
    name: 'Flight recorder', type: 'Data core', faction: 'civil', size: 'small', model: null, role: 'prop',
    fixed: true, flight: heavy({ radius: 1.5, mass: 200, cruise: 0 }),
    shield: 0, hull: 1e6, armor: 1, signature: 0, glow: [1, 0.75, 0.3],
  },

  /* ---------- The Harrow ---------- */
  mite: {
    name: 'Mite', type: 'Harrow swarm drone', faction: 'harrow', size: 'small', model: 'mite', role: 'fighter',
    flight: flight({
      radius: 2.8, mass: 4000, gyration: [1.2, 1.3, 0.9],
      forward: 55, reverse: 30, lateral: 40, boost: 120, cruise: 255, boostSpeed: 340, strafe: 80,
      rate: [2.6, 2.2, 4], angAccel: [14, 11, 18],
    }),
    shield: 0, hull: 22, armor: 0, signature: 0.5, primary: 'mite', score: 40, swarm: true,
  },
  thorn: {
    name: 'Thorn', type: 'Harrow interceptor', faction: 'harrow', size: 'small', model: 'interceptor', role: 'fighter',
    flight: { ...ENEMY },
    shield: 30, hull: 60, armor: 0, signature: 1, shieldRegen: 6, shieldDelay: 4, primary: 'harrow',
    score: 100,
  },
  ninth: {
    name: 'Ninth Hand', type: 'Harrow ace', faction: 'harrow', size: 'small', model: 'interceptor', role: 'fighter',
    tint: 'bone',
    flight: {
      ...ENEMY, accel: { forward: 46, reverse: 28, lateral: 32, boost: 125 },
      fa: { ...ENEMY.fa, forwardSpeed: 230, boostSpeed: 340 }, rate: [2.2, 1.8, 3.4], angAccel: [9, 7, 12],
    },
    shield: 120, hull: 200, armor: 0.1, signature: 1, shieldRegen: 10, shieldDelay: 3, primary: 'harrowAce',
    ace: true, score: 1500,
  },
  talon: {
    name: 'Talon', type: 'Harrow heavy fighter', faction: 'harrow', size: 'small', model: 'talon', role: 'fighter',
    flight: flight({
      radius: 6.5, mass: 36000, gyration: [3.4, 3.8, 2.4],
      forward: 40, reverse: 24, lateral: 24, boost: 105, cruise: 170, boostSpeed: 290, strafe: 55,
      rate: [1.6, 1.3, 2.4], angAccel: [7.5, 6, 10],
    }),
    shield: 70, hull: 170, armor: 0.2, signature: 1.3, shieldRegen: 8, shieldDelay: 4, primary: 'talon',
    missiles: { weapon: 'barb', count: 4 }, score: 220,
  },
  maul: {
    name: 'Maul', type: 'Harrow bomber', faction: 'harrow', size: 'small', model: 'maul', role: 'bomber',
    flight: flight({
      radius: 8, mass: 50000, gyration: [4, 4.6, 3],
      forward: 30, reverse: 18, lateral: 16, boost: 70, cruise: 130, boostSpeed: 200, strafe: 35,
      rate: [1.2, 0.95, 1.8], angAccel: [5, 4, 7],
    }),
    shield: 60, hull: 170, armor: 0.25, signature: 1.6, shieldRegen: 6, shieldDelay: 4, primary: 'harrowHeavy',
    ordnance: { weapon: 'spike', count: 4 }, score: 250,
  },
  eye: {
    name: 'Eye', type: 'Harrow sentry', faction: 'harrow', size: 'small', model: 'sentry', role: 'sentry',
    flight: flight({
      radius: 4.5, mass: 8000, gyration: [2, 2, 2],
      forward: 10, reverse: 10, lateral: 10, boost: 10, cruise: 12, boostSpeed: 12, strafe: 10,
      rate: [0.5, 0.5, 0.5], angAccel: [1, 1, 1],
    }),
    shield: 0, hull: 120, armor: 0, signature: 1, detectRange: 700, score: 150,
  },
  seed: {
    name: 'Seed', type: 'Harrow nest', faction: 'harrow', size: 'large', model: 'seed', role: 'seed',
    flight: heavy({ radius: 21, mass: 6e7, cruise: 35, accel: 4, rate: 0.15, angAccel: 0.1 }),
    shield: 0, hull: 900, armor: 0.85, signature: 2, rock: true, score: 300,
  },
  anchor: {
    name: 'Fold anchor', type: 'Harrow interdictor', faction: 'harrow', size: 'large', model: 'anchor', role: 'anchor',
    fixed: true, flight: heavy({ radius: 34, mass: 5e7, cruise: 0 }),
    shield: 600, hull: 1600, armor: 0.75, signature: 5, shieldRegen: 30, shieldDelay: 5, score: 800,
    subsystems: { emitter: { hull: 700, armor: 0.8, exposed: true } },
  },
  warden: {
    name: 'Warden', type: 'Harrow corvette', faction: 'harrow', size: 'large', model: 'warden', role: 'capital',
    flight: heavy({ radius: 74, mass: 2e7, cruise: 60, accel: 7, rate: 0.16, angAccel: 0.1 }),
    shield: 1200, hull: 3500, armor: 0.5, signature: 6, shieldRegen: 25, shieldDelay: 5, score: 1800,
    subsystems: {
      engine: { hull: 800, armor: 0.5, exposed: true }, bridge: { hull: 900, armor: 0.6 },
      turret: { hull: 240, armor: 0.3, weapon: 'harrowTurret', exposed: true },
    },
    turretWeapons: ['flakTurret', 'harrowTurret'],
  },
  mother: {
    name: 'Mother', type: 'Harrow foundry', faction: 'harrow', size: 'large', model: 'mother', role: 'capital',
    flight: heavy({ radius: 420, mass: 5e9, cruise: 25, accel: 1.5, rate: 0.025, angAccel: 0.012 }),
    shield: 4000, hull: 9000, armor: 0.6, signature: 25, shieldRegen: 40, shieldDelay: 4, score: 5000,
    subsystems: {
      reactor: { hull: 2700, armor: 0.95 }, shield: { hull: 600, armor: 0.5, exposed: true },
      bay: { hull: 700, armor: 0.4, exposed: true }, engine: { hull: 900, armor: 0.5, exposed: true },
      beam: { hull: 800, armor: 0.6, exposed: true, weapon: 'furrow' },
      turret: { hull: 220, armor: 0.3, weapon: 'flakTurret', exposed: true },
    },
    turretWeapons: ['flakTurret', 'harrowTurret'],
  },
  hauler: {
    name: 'Hauler', type: 'Harrow ore tow', faction: 'harrow', size: 'large', model: 'rock:3', modelScale: 0.6, role: 'hauler',
    flight: heavy({ radius: 24, mass: 8e7, cruise: 40, accel: 3, rate: 0.12, angAccel: 0.08 }),
    shield: 0, hull: 2600, armor: 0.85, signature: 4, rock: true, score: 600,
  },
};

/* The hulls a player can fly, in hangar order. */
export const HULLS = ['swift', 'kestrel', 'anvil'];

export const isLarge = cls => CLASSES[cls]?.size === 'large';

// What a subsystem is called to the player (HUD, score popups).
const SUB_NAMES = {
  reactor: 'Reactor', shield: 'Shield generator', engine: 'Engine', bay: 'Launch bay', beam: 'Beam emitter',
  turret: 'Turret', emitter: 'Anchor emitter', drive: 'Drive ring', bridge: 'Bridge', hangar: 'Hangar',
  comms: 'Comms array', dock: 'Docking ring',
};
export const subsystemName = kind => SUB_NAMES[kind] ?? (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Subsystem');

// The legacy fighter stats (config.js) stay for the flight-model checks.
export { PLAYER };
