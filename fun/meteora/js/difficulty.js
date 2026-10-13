/* Meteora — difficulty.

   Four levels. Nothing here changes how anything flies: the Harrow hit
   harder or softer, aim better or worse, fire faster or slower and come in
   larger or smaller numbers; the player's shields recover faster or slower,
   friendly ships are tougher or frailer, and the Tender comes more or less
   often; the Eyes see further and quicker or less far and slower.
   `count` is how missions scale the size of a wave. */

export const DIFFICULTIES = {
  recruit: {
    key: 'recruit', name: 'Recruit', blurb: 'For learning the ship. The Harrow are slow to aim and quick to break.',
    enemyDamage: 0.4, enemyAim: 2.2, enemyFireRate: 0.7, enemyCount: 0.7,
    playerShieldRegen: 1.6, friendlyHull: 1.5, repairDrones: 3, score: 0.5, aiThink: 1.4, playerBias: 0, eyeRange: 0.8, eyeTime: 1.5,
  },
  pilot: {
    key: 'pilot', name: 'Pilot', blurb: 'The intended fight. Every mission is winnable; not every bonus is easy.',
    enemyDamage: 0.65, enemyAim: 1.5, enemyFireRate: 0.85, enemyCount: 0.85,
    playerShieldRegen: 1.25, friendlyHull: 1.2, repairDrones: 2, score: 1, aiThink: 1.15, playerBias: 80, eyeRange: 0.9, eyeTime: 1.2,
  },
  veteran: {
    key: 'veteran', name: 'Veteran', blurb: 'The Harrow at full strength. Choose your loadout with care.',
    enemyDamage: 0.85, enemyAim: 1.15, enemyFireRate: 0.95, enemyCount: 1,
    playerShieldRegen: 1.1, friendlyHull: 1, repairDrones: 1, score: 1.5, aiThink: 1, playerBias: 180, eyeRange: 1, eyeTime: 1,
  },
  ace: {
    key: 'ace', name: 'Ace', blurb: 'More of them, aiming better, hitting harder. One Tender per mission.',
    enemyDamage: 1.1, enemyAim: 0.9, enemyFireRate: 1.05, enemyCount: 1.2,
    playerShieldRegen: 0.95, friendlyHull: 0.9, repairDrones: 1, score: 2, aiThink: 0.85, playerBias: 280, eyeRange: 1.15, eyeTime: 0.8,
  },
};
export const DIFFICULTY_ORDER = ['recruit', 'pilot', 'veteran', 'ace'];
export const DEFAULT_DIFFICULTY = 'pilot';

export const difficulty = key => DIFFICULTIES[key] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];

/* How many ships a wave of `base` becomes at this difficulty (never fewer than one). */
export const count = (diff, base) => Math.max(1, Math.round(base * diff.enemyCount));
