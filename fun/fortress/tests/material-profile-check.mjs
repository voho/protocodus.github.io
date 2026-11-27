import assert from 'node:assert/strict';
import { DIFFICULTIES, FortressSimulation, generateLevel } from '../simulation.js';

const materials = ['wood', 'stone', 'steel', 'glass'];
const profiles = [...materials, 'mixed'];
const mixedShares = [0.31, 0.35, 0.21, 0.13];
const building = (sim) => sim.bodies.filter((piece) => piece.kind === 'block');
const signature = (pieces) => pieces.map((p) => [p.detail, p.width, p.height, p.material]);

for (const { id: size } of DIFFICULTIES) {
  const seeds = new Map();
  for (let seed = 1; seed <= 160 && seeds.size < profiles.length; seed++) {
    const { materialProfile } = generateLevel(size, seed, 3);
    assert.ok(profiles.includes(materialProfile), 'Every new castle rolls a known material profile');
    if (!seeds.has(materialProfile)) seeds.set(materialProfile, seed);
  }
  assert.equal(seeds.size, profiles.length, size + ' generates all five material profiles');

  for (const [profile, seed] of seeds) {
    const sim = new FortressSimulation(size, seed, 3);
    const label = size + ' ' + profile + ' seed ' + seed;
    const pieces = building(sim);
    const counts = new Map(materials.map((m) => [m, 0]));
    assert.equal(sim.level.materialProfile, profile);
    for (const piece of pieces) {
      assert.ok(counts.has(piece.material), label + ' assigns a physical material to every building piece');
      counts.set(piece.material, counts.get(piece.material) + 1);
    }
    for (const [index, material] of materials.entries()) {
      if (profile !== 'mixed' && material !== profile) continue;
      const share = profile === 'mixed' ? mixedShares[index] : 0.70;
      assert.ok(Math.abs(counts.get(material) - pieces.length * share) <= 1,
        label + ' has the requested share of ' + material + ' across all physical blocks');
    }
    if (profile !== 'mixed') continue;

    const original = signature(pieces);
    sim.loadLevel();
    const replay = building(sim);
    assert.equal(sim.level.materialProfile, profile);
    assert.deepEqual(signature(replay), original, label + ' retries with the same material on each piece');

    for (const material of materials) {
      const expected = sim.add('block', material, -300, 150, 20, 20, 'sample');
      const assigned = replay.filter((piece) => piece.material === material);
      assert.ok(assigned.length, label + ' includes ' + material);
      for (const { body } of assigned) {
        assert.ok(Math.abs(body.mass / body.area - expected.body.density) < 1e-8,
          label + ' uses the mass of ' + material + ' for its collision shape');
        assert.equal(body.friction, expected.body.friction, label + ' uses the contact friction of ' + material);
      }
      sim.remove(expected);
      const target = assigned[0];
      sim.blastAt(target.body.position, 12, 'fireball', true, true);
      assert.equal(target.burning, material === 'wood', label + ' uses the flammability of ' + material);
    }
  }
}
