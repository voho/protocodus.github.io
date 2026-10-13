/* Meteora — guns, ordnance and reactors, and what a loadout makes of a hull.

   A loadout is a hull, one primary weapon (every gun on the hull fires it),
   one secondary weapon per bank and a reactor:

     { hull: 'kestrel', primary: 'pulse', secondaries: ['hornet', 'lance'], reactor: 'hearth' }

   Primaries are bolts with a heat budget. Each has multipliers against
   shields, hulls and rock, and a `pierce` that decides how much armour it
   ignores: armour takes `armour × (1 − pierce)` off the hull damage, so a
   Breaker (0.85) bites a reactor that shrugs off Pulse fire (0.05).

   Secondaries fill banks measured in units — a Hornet takes one, a Swarm
   pod two, a Lance four, and Lances only fit a heavy bank.

   Reactors trade between shields, guns, the afterburner and signature —
   how far away the Harrow's Eyes notice the ship.

   `buildStats` turns hull + loadout + difficulty into the numbers the
   simulation runs on; `assess` compares a loadout with what a mission needs
   and explains the mismatch, which the hangar shows. */

import { CLASSES, HULLS } from './catalog.js';

const deg = Math.PI / 180;

const bolt = o => ({
  life: 2.2, radius: 0.3, heat: 0, cool: 0, lockAt: Infinity, releaseAt: 0, gimbal: 0,
  shieldMul: 1, hullMul: 1, rockMul: 1, pierce: 0, length: 7, width: 0.75, ...o,
});

export const PRIMARIES = {
  pulse: bolt({
    name: 'Pulse cannon', short: 'Pulse', blurb: 'Balanced plasma. Good at everything, best at nothing.',
    rate: 10, speed: 1100, damage: 9, pierce: 0.05,
    heat: 4.5, cool: 30, lockAt: 100, releaseAt: 40, gimbal: 10 * deg,
    color: [0.45, 0.62, 1.0], length: 9, width: 0.9,
  }),
  needle: bolt({
    name: 'Needle gun', short: 'Needle', blurb: 'Fast, light bolts that are easy to land on fighters. Weak against armour and rock.',
    rate: 18, speed: 1500, life: 1.6, damage: 5, shieldMul: 1.15, hullMul: 0.8, rockMul: 0.5, pierce: 0,
    heat: 2.4, cool: 30, lockAt: 100, releaseAt: 40, gimbal: 14 * deg,
    color: [0.8, 0.95, 1.0], length: 8, width: 0.55,
  }),
  ion: bolt({
    name: 'Ion scald', short: 'Ion', blurb: 'Strips shields nearly three times as fast as Pulse and scrambles them, so they cannot recharge for a while. Weak against bare hulls.',
    rate: 7, speed: 950, damage: 11, shieldMul: 2.6, hullMul: 0.55, rockMul: 0.2, pierce: 0, scramble: 2.5,
    heat: 5, cool: 30, lockAt: 100, releaseAt: 40, gimbal: 8 * deg,
    color: [0.45, 1.0, 0.55], length: 8, width: 1.0,
  }),
  breaker: bolt({
    name: 'Breaker driver', short: 'Breaker', blurb: 'Slow, heavy slugs that punch through armour and crack rock. Runs hot.',
    rate: 3.5, speed: 800, life: 2.5, damage: 34, shieldMul: 0.55, hullMul: 1.5, rockMul: 2.5, pierce: 0.85,
    heat: 15, cool: 30, lockAt: 100, releaseAt: 40, gimbal: 6 * deg,
    color: [1.0, 0.55, 0.2], length: 6, width: 1.3, radius: 0.45,
  }),
};

/* Guns nobody chooses: the Harrow's, the turrets', the Anvil's tail gun. */
export const NPC_GUNS = {
  mite: bolt({ rate: 4, speed: 900, life: 1.6, damage: 2.2, color: [1.0, 0.4, 0.15], length: 5, width: 0.5, burst: [0.4, 0.8], pause: [0.6, 1.2] }),
  harrow: bolt({ rate: 5, speed: 850, damage: 3.6, color: [1.0, 0.32, 0.1], length: 7, burst: [0.6, 1.1], pause: [0.8, 1.4] }),
  talon: bolt({ rate: 4, speed: 900, damage: 6.5, pierce: 0.15, color: [1.0, 0.22, 0.12], length: 9, width: 1.0, burst: [0.8, 1.3], pause: [0.8, 1.4] }),
  harrowAce: bolt({ rate: 7, speed: 950, damage: 5, pierce: 0.1, color: [1.0, 0.85, 0.7], length: 8, burst: [0.9, 1.5], pause: [0.5, 0.9] }),
  harrowHeavy: bolt({ rate: 3, speed: 800, damage: 5.5, pierce: 0.1, color: [1.0, 0.28, 0.08], length: 8, burst: [0.7, 1.1], pause: [0.9, 1.5] }),
  wingPulse: bolt({ rate: 8, speed: 1100, damage: 8, pierce: 0.05, color: [0.45, 0.62, 1.0], length: 9, burst: [0.8, 1.6], pause: [0.5, 1.0] }),
  wingBreaker: bolt({ rate: 3, speed: 800, damage: 30, hullMul: 1.5, rockMul: 2.5, shieldMul: 0.55, pierce: 0.85, color: [1.0, 0.55, 0.2], length: 6, burst: [0.8, 1.4], pause: [0.6, 1.0] }),
  tailgun: bolt({ rate: 6, speed: 1300, life: 1.2, damage: 4, color: [0.8, 0.95, 1.0], length: 7, width: 0.55 }),
  stationTurret: bolt({ rate: 1.1, speed: 1000, life: 2, damage: 10, pierce: 0.1, slew: 0.8, color: [0.6, 0.8, 1.0], length: 11, width: 1.1, range: 1300 }),
  oldTurret: bolt({ rate: 0.9, speed: 1000, life: 2, damage: 11, pierce: 0.1, slew: 0.6, color: [0.55, 0.75, 1.0], length: 12, width: 1.2, range: 1400 }),
  plasmaTurret: bolt({ rate: 2.2, speed: 1100, life: 2, damage: 14, pierce: 0.1, slew: 0.8, color: [0.5, 0.75, 1.0], length: 12, width: 1.2, range: 1600 }),
  harrowTurret: bolt({ rate: 1.5, speed: 950, life: 2.2, damage: 6.5, pierce: 0.1, slew: 0.9, color: [1.0, 0.3, 0.08], length: 11, width: 1.2, range: 1600 }),
  flakTurret: bolt({ rate: 0.9, speed: 700, life: 3, damage: 14, flak: 22, slew: 0.7, color: [1.0, 0.55, 0.15], length: 4, width: 1.4, range: 1700, pd: true }),
  flakTurretWatch: bolt({ rate: 1.0, speed: 750, life: 2.6, damage: 13, flak: 22, slew: 0.8, color: [0.6, 0.85, 1.0], length: 4, width: 1.4, range: 1600, pd: true }),
  furrow: { beam: true, charge: 3.5, fire: 2.5, cooldown: [16, 22], range: 3500, radius: 7, dps: 900, smallDps: 120, track: 0.015, color: [1.0, 0.18, 0.08] },
};

export const GUNS = { ...PRIMARIES, ...NPC_GUNS };

const ordnance = o => ({
  launchKick: 30, ignition: 0.25, navGain: 4, fuse: 12, radius: 0.6, hp: 0, push: 3e5,
  lockCone: 15 * deg, lockRange: 3000, lockOn: 'any', shieldMul: 1, hullMul: 1, rockMul: 1.5, ...o,
});

export const SECONDARIES = {
  hornet: ordnance({
    name: 'Hornet missile', short: 'Hornet', units: 1, blurb: 'A homing missile that locks on anything. The safe choice.',
    lockTime: 0.8, accel: 220, maxSpeed: 650, maxLateral: 350, life: 8, damage: 80, blast: 30, pierce: 0.3,
  }),
  swarm: ordnance({
    name: 'Swarm pod', short: 'Swarm', units: 2, salvo: 4, spread: 4 * deg,
    blurb: 'Four heat-seeking rockets at once. Locks fast; shreds fighters and bombers.',
    lockTime: 0.35, lockCone: 20 * deg, lockRange: 2000, accel: 260, maxSpeed: 520, maxLateral: 280, navGain: 3,
    life: 5, damage: 34, blast: 14, fuse: 8, pierce: 0.1, push: 1e5,
  }),
  lance: ordnance({
    name: 'Lance torpedo', short: 'Lance', units: 4, heavy: true,
    blurb: 'A capital-ship killer: locks only on large targets and subsystems, flies slow, and can be shot down.',
    lockOn: 'large', lockTime: 2, lockCone: 20 * deg, lockRange: 3500, launchKick: 12, ignition: 0.4,
    accel: 70, maxSpeed: 260, maxLateral: 45, navGain: 3, life: 22, damage: 900, blast: 70, fuse: 0,
    radius: 1.2, hp: 30, pierce: 1, rockMul: 2, push: 2e6, torpedo: true,
  }),
  barb: ordnance({
    name: 'Barb missile', short: 'Barb', units: 1, harrow: true,
    lockTime: 1.2, accel: 180, maxSpeed: 560, maxLateral: 260, navGain: 3.5, life: 7, damage: 45, blast: 22, fuse: 10, pierce: 0.2,
  }),
  spike: ordnance({
    name: 'Spike torpedo', short: 'Spike', units: 4, heavy: true,
    lockOn: 'large', lockTime: 1.5, lockCone: 25 * deg, lockRange: 2200, launchKick: 10, ignition: 0.5,
    accel: 60, maxSpeed: 220, maxLateral: 40, navGain: 3, life: 24, damage: 400, blast: 50, fuse: 0,
    // Meant to be shot down: guns hit it anywhere along its length.
    radius: 1.2, hitRadius: 2.5, hp: 30, pierce: 1, push: 1.2e6, torpedo: true, harrow: true,
  }),
};
export const PLAYER_SECONDARIES = ['hornet', 'swarm', 'lance'];

export const REACTORS = {
  hearth: { name: 'Hearth', type: 'Standard', blurb: 'The reactor every Watch hull leaves the yard with.', shield: 1, regen: 1, cool: 1, boost: 1, signature: 1 },
  forge: { name: 'Forge', type: 'Overdrive', blurb: 'Half again the gun cooling and a longer afterburner, paid for in shields — and it runs loud.', shield: 0.8, regen: 0.7, cool: 1.5, boost: 1.35, signature: 1.35 },
  aegis: { name: 'Aegis', type: 'Bulwark', blurb: 'Forty per cent more shield, recharging faster. Guns cool slower.', shield: 1.4, regen: 1.6, cool: 0.85, boost: 0.85, signature: 1.1 },
  hush: { name: 'Hush', type: 'Ghost', blurb: 'Less than half the signature, quieter still when the guns are cold. Weaker shields.', shield: 0.85, regen: 0.9, cool: 0.9, boost: 1, signature: 0.45, silent: 0.6 },
};

/* ---------- loadouts ---------- */

export function bankCount(bank, weaponKey) {
  const w = SECONDARIES[weaponKey];
  if (!w || (w.heavy && !bank.heavy)) return 0;
  return Math.floor(bank.capacity / w.units);
}

export function defaultLoadout(hull = 'kestrel') {
  const d = CLASSES[hull].defaults;
  return { hull, primary: d.primary, secondaries: [...d.secondaries], reactor: d.reactor };
}

/* Repair a loadout against a hull and what is unlocked: anything missing,
   locked or illegal falls back to the first legal choice. */
export function normalizeLoadout(loadout, unlocked = null) {
  const allowed = (kind, key) => !unlocked || unlocked[kind]?.includes(key);
  const hull = HULLS.includes(loadout?.hull) && allowed('hulls', loadout.hull) ? loadout.hull
    : HULLS.find(h => allowed('hulls', h)) ?? 'kestrel';
  const cls = CLASSES[hull];
  const firstPrimary = Object.keys(PRIMARIES).find(k => allowed('primaries', k)) ?? 'pulse';
  const primary = PRIMARIES[loadout?.primary] && allowed('primaries', loadout.primary) ? loadout.primary : firstPrimary;
  const secondaries = cls.banks.map((bank, i) => {
    const want = loadout?.secondaries?.[i];
    if (want && allowed('secondaries', want) && bankCount(bank, want) > 0) return want;
    return PLAYER_SECONDARIES.find(k => allowed('secondaries', k) && bankCount(bank, k) > 0) ?? 'hornet';
  });
  const firstReactor = Object.keys(REACTORS).find(k => allowed('reactors', k)) ?? 'hearth';
  const reactor = REACTORS[loadout?.reactor] && allowed('reactors', loadout.reactor) ? loadout.reactor : firstReactor;
  return { hull, primary, secondaries, reactor };
}

/* The stats a loadout flies with. `diff` is a difficulty from
   difficulty.js (only its player shield regen matters here). */
export function buildStats(loadout, diff = null) {
  const L = normalizeLoadout(loadout);
  const cls = CLASSES[L.hull], R = REACTORS[L.reactor];
  const regenMul = R.regen * (diff?.playerShieldRegen ?? 1);
  const flight = {
    ...cls.flight,
    boost: { ...cls.flight.boost, capacity: cls.flight.boost.capacity * R.boost, regen: cls.flight.boost.regen * R.boost },
  };
  const gun = { ...PRIMARIES[L.primary], cool: PRIMARIES[L.primary].cool * R.cool };
  const banks = cls.banks.map((bank, i) => {
    const weapon = L.secondaries[i];
    const count = bankCount(bank, weapon);
    return { weapon, count, max: count, heavy: bank.heavy, capacity: bank.capacity };
  });
  return {
    loadout: L, cls, flight, gun, banks,
    shield: Math.round(cls.shield * R.shield), hull: cls.hull, armor: cls.armor,
    shieldRegen: cls.shieldRegen * regenMul, shieldDelay: cls.shieldDelay,
    signature: cls.signature * R.signature, silent: R.silent ?? 1,
    rearTurret: cls.rearTurret ?? null,
  };
}

/* ---------- the hangar's advice ---------- */

/* Rough figures for the hangar's stat bars, each 0…1. */
export function ratings(loadout) {
  const s = buildStats(loadout);
  const g = s.gun;
  const dps = g.rate * g.damage;
  const ord = s.banks.reduce((n, b) => n + b.count * (SECONDARIES[b.weapon].damage * (SECONDARIES[b.weapon].salvo ?? 1)), 0);
  return {
    speed: s.flight.fa.forwardSpeed / 260,
    agility: (s.flight.rate[0] + s.flight.rate[1]) / 4.6,
    shields: s.shield / 260,
    hull: s.hull / 240,
    guns: dps / 130,
    armourBite: Math.min(1, (g.pierce + g.rockMul / 3) / 1.3),
    ordnance: Math.min(1, ord / 3600),
    stealth: Math.max(0, 1 - s.signature / 2.2),
  };
}

/* What a mission's `needs` mean, and how a loadout meets them. Returns the
   problems worth saying out loud, worst first. */
export function assess(needs = {}, loadout, diff = null) {
  const s = buildStats(loadout), L = s.loadout, out = [];
  const has = key => L.secondaries.includes(key);
  if (needs.armor && L.primary !== 'breaker' && !has('lance')) {
    out.push({ level: 'warn', text: 'No Breakers and no Lances: armoured targets will barely notice your guns.' });
  }
  if (needs.torpedoes && !has('lance')) {
    out.push({ level: 'warn', text: needs.torpedoes === true ? 'No Lance torpedoes: the heaviest targets will be left to your wing.' : needs.torpedoes });
  }
  if (needs.stealth && s.signature > 0.75) {
    out.push({ level: 'warn', text: `Signature ×${s.signature.toFixed(2)}: Eyes will notice you ${Math.round(700 * s.signature * (diff?.eyeRange ?? 1))} m out at full speed. A Hush reactor or a Swift keeps you quiet.` });
  }
  if (needs.intercept && L.hull === 'anvil') {
    out.push({ level: 'warn', text: 'An Anvil is too slow to catch bombers before they launch.' });
  }
  if (needs.shields && L.primary !== 'ion') {
    out.push({ level: 'warn', text: 'No Ion: the tugs\' shields keep charging under other guns. Expect a long fight and haulers slipping through.' });
  }
  if (needs.endurance && L.reactor !== 'aegis' && L.hull !== 'anvil') {
    out.push({ level: 'tip', text: 'A long fight: an Aegis reactor keeps your shields up.' });
  }
  if (needs.fighters && L.primary === 'breaker') {
    out.push({ level: 'tip', text: 'Breaker slugs are slow and hard to land on fighters.' });
  }
  if (needs.rocks && L.primary !== 'breaker' && !has('lance')) {
    out.push({ level: 'warn', text: 'Seeds are armoured stone: Breakers crack them at 2.5×, a Lance splits one.' });
  }
  return out;
}

export function matchesRecommendation(rec, loadout) {
  if (!rec) return {};
  const L = normalizeLoadout(loadout);
  return {
    hull: !rec.hull || rec.hull === L.hull,
    primary: !rec.primary || rec.primary === L.primary,
    secondaries: L.secondaries.map((s, i) => !rec.secondaries?.[i] || rec.secondaries[i] === s),
    reactor: !rec.reactor || rec.reactor === L.reactor,
  };
}
