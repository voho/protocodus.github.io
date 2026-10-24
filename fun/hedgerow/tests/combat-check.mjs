// Run with: node fun/hedgerow/tests/combat-check.mjs
// A grenade reports only its own kills, after damage has been resolved:
// survivors, cover, corpses and other people's grenades do not inflate it.
import './three-hooks.mjs';
import assert from 'node:assert/strict';
const THREE = await import('three');
const { createExplosives } = await import('../js/combat.js');
const { default: level } = await import('../js/levels/saint-clair.js');

const noop = () => {};
function game() {
  const notices = [];
  const G = {
    models: new Map(), matlib: { resolve: (m) => m }, scene: new THREE.Scene(),
    world: { water: null, clear: (_x, _y, _z, tx) => tx !== 3, raycast: () => null },
    terrain: { height: () => 0, surfaceAt: () => 'mud' },
    effects: { explosion: noop, splash: noop }, audio: { explosion: noop },
    lights: { flash: noop }, events: { emit: noop }, rig: { addShake: noop },
    camera: { position: new THREE.Vector3(0, 1.6, 30) },
    player: { alive: true, pos: new THREE.Vector3(0, 0, 30), damage: noop },
    enemies: [], hud: { grenadeWarning: noop, notice: (...args) => notices.push(args) },
    diff: { damage: 1 }, stats: { kills: 23 },
  };
  return { G, explosives: createExplosives(G), notices };
}
function enemy(x, health = 100, dead = false) {
  return {
    pos: new THREE.Vector3(x, 0, 0), health, dead, hits: 0, suppressed: 0,
    damage(amount, _from, _part, byPlayer) {
      this.hits++;
      this.byPlayer = byPlayer;
      this.health -= amount;
      this.dead = this.health <= 0;
      return this.dead;
    },
    suppress() { this.suppressed++; },
  };
}
function detonate(explosives, kind = 'player') {
  const at = new THREE.Vector3(0, 0.05, 0);
  const e = kind === 'charge' ? explosives.placeCharge(at, 0.01) : explosives.throwGrenade(kind, at, new THREE.Vector3());
  e.rest = true; e.fuse = 0.01;
  explosives.update(1 / 60);
  assert.equal(explosives.list.length, 0);
}

{
  const { G, explosives, notices } = game();
  const near = enemy(1), alsoNear = enemy(-1), survivor = enemy(2, 1000);
  const behindWall = enemy(3), corpse = enemy(0.5, 0, true), far = enemy(30);
  G.enemies.push(near, alsoNear, survivor, behindWall, corpse, far);
  detonate(explosives);
  assert.deepEqual(notices, [['Grenade', '2 enemies killed', 3]]);
  assert.ok(near.dead && alsoNear.dead && near.byPlayer);
  assert.ok(!survivor.dead && survivor.hits === 1, 'a hit without a kill does not count');
  assert.equal(behindWall.hits, 0, 'cover blocks grenade damage');
  assert.equal(corpse.hits, 0, 'old kills do not count');
  assert.equal(far.hits, 0, 'distant enemies do not count');
  G.enemies.push(enemy(-2));
  detonate(explosives);
  assert.deepEqual(notices.at(-1), ['Grenade', '1 enemy killed', 3], 'each blast has its own count and singular wording');
  assert.equal(notices.length, 2);
}
for (const kind of ['enemy', 'charge']) {
  const { G, explosives, notices } = game();
  G.enemies.push(enemy(1));
  detonate(explosives, kind);
  assert.ok(G.enemies[0].dead, 'explosive still damages enemies');
  assert.equal(notices.length, 0, `${kind} is not credited as a player grenade`);
}
{
  const { G, explosives, notices } = game();
  G.enemies.push(enemy(1, 1000));
  detonate(explosives);
  assert.equal(notices.length, 0, 'a nonlethal grenade does not report a kill');
}

assert.ok(level.enemies.every((e) => ['rifle', 'smg', 'mg', 'officer'].includes(e.type)), 'the mission has no sniper');
assert.ok(level.hints.every((h) => !/sniper|glint/i.test(`${h.text} ${h.sub}`)), 'no tutorial points players to a removed sniper');
console.log('combat-check: grenade notices count only the blast’s kills; no sniper in the mission');
