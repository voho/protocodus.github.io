/* Mission equipment belongs to the simulation. A checkpoint can restore
   only the weapons actually carried in this operation. */
import { WEAPONS, GRENADE } from './config.js';

const DEFAULT_LOADOUT = Object.freeze(['garand', 'thompson']);

export function missionLoadout(level = {}) {
  const requested = Array.isArray(level?.loadout) ? level.loadout : DEFAULT_LOADOUT;
  const weapons = [...new Set(requested.filter(id => typeof id === 'string' && Object.hasOwn(WEAPONS, id)))].slice(0, 2);
  return Object.freeze(weapons.length ? weapons : [...DEFAULT_LOADOUT]);
}

const count = (value, fallback, max) => Number.isFinite(value)
  ? Math.max(0, Math.min(Math.floor(max), Math.floor(value))) : fallback;

export function loadoutInventory(weapons, saved = null) {
  const ammo = {};
  for (const id of weapons) {
    const w = WEAPONS[id], old = saved?.ammo?.[id];
    ammo[id] = { mag: count(old?.mag, w.mag, w.mag), reserve: count(old?.reserve, w.reserve, w.reserve * 1.5) };
  }
  return {
    ammo,
    grenades: count(saved?.grenades, GRENADE.carry, GRENADE.max),
    weapon: weapons.includes(saved?.weapon) ? saved.weapon : weapons[0],
  };
}
