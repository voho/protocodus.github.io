/* Specialist enemy roles layered on the existing hull classes. A role changes
 * behaviour, durability and rewards; the renderer marks it with overlays, so no
 * new hull artwork is needed and derived sprite caches stay bounded. */
export const ROLES = Object.freeze(['midboss', 'captor', 'elite', 'shielded', 'splitter', 'miner', 'bomber', 'phantom', 'medic', 'mine', 'convoy', 'meteor', 'ace']);
// Drifting hazards: shot or dodged, never counted as a crowd that slows terrain.
export const HAZARD_ROLES = new Set(['mine', 'meteor']);
export const MINE_LIFETIME = 14;
export const PHANTOM_CYCLE = 4.2, PHANTOM_VISIBLE = 2.4;

/** Give a hull a recharging energy barrier sized from its current armor. */
export function addBarrier(enemy, fraction) {
  enemy.shieldMax = Math.round(enemy.maxHp * fraction); enemy.shieldHp = enemy.shieldMax; enemy.shieldHit = -10;
  return enemy;
}

/** Assign a role once at spawn. Stats saved with the ship carry the result.
 * Firing multipliers stay within the saved tactic bounds. */
export function applyRole(enemy, role, options = {}) {
  enemy.role = role;
  switch (role) {
    case 'elite':
      enemy.hp *= 1.6; enemy.maxHp = enemy.hp; enemy.tacticFire = Math.min(2, (enemy.tacticFire || 1) * 1.25); break;
    case 'ace':
      enemy.hp *= 2.4; enemy.maxHp = enemy.hp; enemy.tacticFire = Math.min(2, (enemy.tacticFire || 1) * 1.3); enemy.aceName = options.aceName ?? 0;
      // Aces fly with a light barrier: open it with energy fire, then finish the hull.
      addBarrier(enemy, .25); break;
    case 'shielded':
      addBarrier(enemy, .55); break;
    case 'phantom':
      enemy.cloak = options.cloak ?? 0; enemy.cloaked = false; break;
    case 'medic':
      enemy.healClock = .6; enemy.noFire = true; break;
    case 'miner':
      enemy.dropTimer = .9; enemy.noFire = true; break;
    case 'mine':
      enemy.hp = enemy.maxHp = 10; enemy.radius = 15; enemy.noFire = true; enemy.speed = 42; enemy.vy = 42; enemy.vx = 0;
      enemy.driftX = options.driftX ?? 0; break;
    case 'meteor':
      enemy.hp = enemy.maxHp = 26; enemy.radius = options.radius ?? 24; enemy.noFire = true;
      enemy.speed = options.speed ?? 150; enemy.vy = enemy.speed; enemy.vx = 0;
      enemy.driftX = options.driftX ?? 0; enemy.spinRate = options.spinRate ?? 1; enemy.variant = options.variant ?? 0; break;
    case 'convoy':
      enemy.hp *= .7; enemy.maxHp = enemy.hp; enemy.noFire = true; enemy.harmless = true; break;
    default: break;
  }
  return enemy;
}

export const roleScoreScale = enemy => enemy.role === 'elite' || enemy.role === 'ace' ? 2 : enemy.role === 'medic' ? 1.5 : enemy.role === 'mine' ? .3 : enemy.role === 'meteor' ? .4 : 1;
export const roleCreditScale = enemy => enemy.role === 'convoy' ? 4 : enemy.role === 'ace' ? 3 : enemy.role === 'elite' ? 2 : enemy.role === 'mine' || enemy.role === 'meteor' ? .5 : 1;
export const roleCollisionDamage = enemy => enemy.role === 'mine' ? 30 : enemy.role === 'meteor' ? 18 : 22;
/** Hull classes a medic repairs: never bosses, hazards or other medics. */
export const healable = enemy => !enemy.dead && !enemy.boss && !HAZARD_ROLES.has(enemy.role) && enemy.role !== 'medic' && enemy.hp > 0 && enemy.hp < enemy.maxHp;
