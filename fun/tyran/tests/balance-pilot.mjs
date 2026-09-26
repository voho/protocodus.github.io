// One deterministic, difficulty-blind pilot policy. It only returns normal game
// controls and buys stock through the public shop functions while in the hangar.
import { buyUpgrade, upgradeCost, buySupply, MAX_UPGRADE, PLAYER_SPEED } from '../sim.js';
import { isDormant } from '../waves.js';

export const PILOT_VERSION = 'predictive-pilot-v1';

export function pilotControls(state, pilot) {
  if (!pilot.alive) return {};
  let target = null, priority = -Infinity;
  for (const enemy of state.enemies) {
    if (enemy.dead || enemy.y > pilot.y - 35 || enemy.y < 0 || isDormant(enemy)) continue;
    const score = enemy.boss ? 2000 : enemy.y - Math.abs(enemy.x - pilot.x) * .5 + enemy.radius * 2;
    if (score > priority) { target = enemy; priority = score; }
  }
  let aimX = state.width * .5, aimY = state.height * .77;
  if (target) {
    const flight = Math.min(.65, Math.max(0, (pilot.y - target.y) / 900));
    aimX = target.x + (target.vx || 0) * flight;
  }
  // Prefer nearby useful drops, without pursuing loot into the top firing lanes.
  let pickup = null, pickupScore = 0;
  for (const item of state.pickups) {
    if (item.y < state.height * .42 || item.y > state.height - 45 || item.lock > 0) continue;
    const value = item.kind === 'power' && pilot.power < 4 ? 170 : item.kind === 'drone' && pilot.drones < 2 ? 165
      : item.kind === 'repair' && pilot.hull < pilot.maxHull ? 150 : item.kind === 'invulnerable' ? 130
      : item.kind === 'rapid' ? 110 : item.kind === 'bomb' && pilot.bombs < 5 ? 100 : 45;
    const score = value - Math.hypot(item.x - pilot.x, item.y - pilot.y) * .35;
    if (score > pickupScore) { pickup = item; pickupScore = score; }
  }
  if (pickup) { aimX = pickup.x; aimY = Math.min(state.height - 55, pickup.y + 20); }
  const threats = state.bullets.filter(b => b.team < 0 && Math.hypot(b.x - pilot.x, b.y - pilot.y) < 330);
  let best = null, bestScore = Infinity, bestDanger = Infinity;
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
    const norm = Math.max(1, Math.hypot(x, y)), vx = x / norm * PLAYER_SPEED, vy = y / norm * PLAYER_SPEED;
    const px = pilot.x + vx * .23, py = pilot.y + vy * .23;
    let score = Math.abs(px - aimX) * .08 + Math.abs(py - aimY) * (pickup ? .1 : .016), danger = 0;
    if (px < 35 || px > state.width - 35 || py < 115 || py > state.height - 50) score += 120;
    for (const bullet of threats) {
      const rx = bullet.x - pilot.x, ry = bullet.y - pilot.y, dx = bullet.vx - vx, dy = bullet.vy - vy;
      const time = Math.max(0, Math.min(.48, -(rx * dx + ry * dy) / (dx * dx + dy * dy || 1)));
      const separation = Math.hypot(rx + dx * time, ry + dy * time);
      danger += Math.max(0, 1 - separation / 70) ** 3 * 85 * (1 - time);
    }
    for (const enemy of state.enemies) {
      if (enemy.dead || isDormant(enemy) || enemy.harmless) continue;
      const separation = Math.hypot(enemy.x + (enemy.vx || 0) * .23 - px, enemy.y + (enemy.vy || 0) * .23 - py);
      danger += Math.max(0, 1 - separation / (enemy.radius + 50)) ** 2 * 110;
      if (enemy.ai === 'captor' && enemy.capState === 2 && py > enemy.y && Math.abs(px - enemy.x) < 90) danger += 70;
    }
    for (const beam of state.beams || []) {
      if (beam.t < beam.warn - .4) continue;
      const owner = state.enemies.find(e => e.id === beam.owner && !e.dead);
      if (!owner) continue;
      const dx = px - owner.x - (beam.dx || 0), dy = py - owner.y - (beam.dy || 0);
      const along = dx * Math.cos(beam.angle) + dy * Math.sin(beam.angle);
      const across = Math.abs(-dx * Math.sin(beam.angle) + dy * Math.cos(beam.angle));
      if (along > 0) danger += Math.max(0, 1 - across / 90) ** 2 * 150;
    }
    score += danger;
    if (score < bestScore) { bestScore = score; bestDanger = danger; best = { x, y, fire: true }; }
  }
  // Plasma is an aimed burst, not a permanently held replacement for the primary.
  best.secondary = !!target && pilot.power < 3 && Math.abs(target.x - pilot.x) < target.radius + 24
    && pilot.y - target.y < 720 && (target.boss || target.hp > 60) && !pilot.fireEnergyLocked && pilot.fireEnergy >= 20;
  // A fresh Nova press is a finite inventory decision, never a direct state edit.
  best.bomb = !pilot.bombHeld && pilot.bombs > 0 && !pilot.guard && !pilot.invulnerableTime
    && ((bestDanger > 24 && pilot.shield < pilot.maxShield * .45) || (threats.length > 12 && pilot.hull < pilot.maxHull * .5));
  return best;
}

export function buyBalanced(state) {
  const purchases = [];
  const buy = (kind, id) => {
    const credits = state.credits;
    if (!(kind === 'upgrade' ? buyUpgrade(state, id) : buySupply(state, id))) return false;
    purchases.push({ kind, id, cost: credits - state.credits }); return true;
  };
  // Preserve a reserve before investing in the next sector, then improve offense
  // enough to clear capital ships while keeping defenses at comparable tiers.
  while (state.lives < 2 && buy('supply', 'life')) {}
  const desired = [2, 4, 5, 6, 6, 6, 6, 6, 6][state.level] ?? MAX_UPGRADE;
  while (state.upgrades.weapon < desired && buy('upgrade', 'weapon')) {}
  if (state.players[0].drones < 1) buy('supply', 'drone');
  for (let i = 0; i < 18; i++) {
    const choices = ['recharge', 'shield', 'hull'].filter(id => state.upgrades[id] < MAX_UPGRADE)
      .sort((a, b) => state.upgrades[a] - state.upgrades[b] || upgradeCost(state, a) - upgradeCost(state, b));
    if (!choices.some(id => buy('upgrade', id))) break;
  }
  while (state.players[0].bombs < 3 && buy('supply', 'bomb')) {}
  return purchases;
}
